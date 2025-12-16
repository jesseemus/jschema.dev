import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
  type ReactFlowInstance,
  type Connection,
  type OnConnectStartParams,
  addEdge,
  MarkerType,
} from 'reactflow';
import { Trash2, Layout, Download, Boxes } from 'lucide-react';
import 'reactflow/dist/style.css';
import './DataModelBuilder.css';
import { SchemaPalette } from './SchemaPalette';
import { BuilderNode, type BuilderNodeData } from './BuilderNode';
import { 
  generateInstanceId, 
  resetInstanceCounters,
  setInstanceCounter,
  extractSchemaInfo,
  type DataInstance,
  type DataConnection,
} from '../utils/builderTypes';
import { 
  validateConnection,
  getValidTargets,
  getValidSources,
} from '../utils/connectionValidator';
import { getSchemaConnectionRules } from '../utils/schemaRelationships';
import { exportToJson, downloadFile } from '../utils/dataModelExport';
import {
  saveBuilderState,
  loadBuilderState,
  clearBuilderState,
  restoreInstanceCounters,
  debounce,
} from '../utils/builderStorage';

interface DataModelBuilderProps {
  schemas: Record<string, object>;
}

// Register custom node types
const nodeTypes = {
  builderNode: BuilderNode,
};

const proOptions = { hideAttribution: false };

export const DataModelBuilder: React.FC<DataModelBuilderProps> = ({ schemas }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  
  // State for tracking connections during drag
  const [connectingFrom, setConnectingFrom] = useState<OnConnectStartParams | null>(null);
  
  // Clipboard state for copy/paste
  const [clipboard, setClipboard] = useState<Node[]>([]);
  
  // Track hovered edge for keyboard deletion
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  // Create debounced save function (stable reference)
  const debouncedSave = useMemo(
    () => debounce((nodesToSave: Node[], edgesToSave: typeof edges) => {
      saveBuilderState(nodesToSave, edgesToSave);
    }, 500),
    []
  );

  // Load saved state on mount
  useEffect(() => {
    const savedState = loadBuilderState();
    if (savedState && savedState.nodes.length > 0) {
      // Restore instance counters first to prevent ID collisions
      restoreInstanceCounters(savedState.nodes, setInstanceCounter);
      
      // Reconstruct nodes with full data
      const restoredNodes: Node[] = savedState.nodes.map((serializedNode) => ({
        id: serializedNode.id,
        type: serializedNode.type || 'builderNode',
        position: serializedNode.position,
        data: {
          label: `${serializedNode.data.schemaTitle} (${serializedNode.data.instanceId})`,
          schemaPath: serializedNode.data.schemaPath,
          instanceId: serializedNode.data.instanceId,
          schemaTitle: serializedNode.data.schemaTitle,
          schemas,
          values: serializedNode.data.values,
        } as BuilderNodeData,
      }));

      // Reconstruct edges with styling
      const restoredEdges = savedState.edges.map((serializedEdge) => {
        // Determine if this is an array connection for styling
        const sourceNode = restoredNodes.find(n => n.id === serializedEdge.source);
        const sourceData = sourceNode?.data as BuilderNodeData | undefined;
        let isArrayConnection = false;
        
        if (sourceData?.schemaPath && schemas[sourceData.schemaPath]) {
          const rules = getSchemaConnectionRules(schemas[sourceData.schemaPath], sourceData.schemaPath);
          const rule = rules.find(r => r.propertyPath === serializedEdge.sourceHandle);
          isArrayConnection = rule?.cardinality === 'many';
        }

        return {
          id: serializedEdge.id,
          source: serializedEdge.source,
          target: serializedEdge.target,
          sourceHandle: serializedEdge.sourceHandle,
          targetHandle: serializedEdge.targetHandle || 'target',
          type: 'default',
          animated: false,
          style: {
            stroke: isArrayConnection ? '#ffa726' : '#61dafb',
            strokeWidth: 2,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isArrayConnection ? '#ffa726' : '#61dafb',
          },
          label: serializedEdge.sourceHandle,
          labelStyle: {
            fill: '#ccc',
            fontSize: 10,
          },
          labelBgStyle: {
            fill: '#1e1e1e',
            fillOpacity: 0.8,
          },
        };
      });

      setNodes(restoredNodes);
      setEdges(restoredEdges);
    }
    setIsInitialized(true);
  }, [schemas, setNodes, setEdges]);

  // Auto-save on node/edge changes (after initialization)
  useEffect(() => {
    if (isInitialized) {
      debouncedSave(nodes, edges);
    }
  }, [nodes, edges, isInitialized, debouncedSave]);

  // Build instances map from nodes for validation
  const instancesMap = useMemo(() => {
    const map = new Map<string, DataInstance>();
    nodes.forEach((node) => {
      const nodeData = node.data as unknown as BuilderNodeData | undefined;
      if (nodeData?.schemaPath) {
        map.set(node.id, {
          id: node.id,
          schemaPath: nodeData.schemaPath,
          position: node.position,
          data: {},
        });
      }
    });
    return map;
  }, [nodes]);

  // Convert edges to DataConnection format for validation
  const dataConnections = useMemo<DataConnection[]>(() => {
    return edges.map((edge) => ({
      id: edge.id,
      sourceId: edge.source,
      targetId: edge.target,
      propertyPath: edge.sourceHandle || '',
    }));
  }, [edges]);

  // Build connected handles map for each node
  const connectedHandlesMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    edges.forEach((edge) => {
      if (!map.has(edge.source)) {
        map.set(edge.source, new Set());
      }
      if (edge.sourceHandle) {
        map.get(edge.source)!.add(edge.sourceHandle);
      }
    });
    return map;
  }, [edges]);

  // Memoize schema info for node labels
  const schemaInfoMap = useMemo(() => {
    const map = new Map<string, { title: string; description?: string }>();
    Object.entries(schemas).forEach(([path, schema]) => {
      const info = extractSchemaInfo(path, schema);
      map.set(path, { title: info.title, description: info.description });
    });
    return map;
  }, [schemas]);

  // Get valid connection targets when connecting (bidirectional)
  // When dragging from source handle: highlight valid targets
  // When dragging from target handle: highlight valid sources (nodes that can connect to this one)
  const validTargetIds = useMemo(() => {
    if (!connectingFrom?.nodeId || !connectingFrom?.handleId) {
      return new Set<string>();
    }
    
    const draggedNode = nodes.find(n => n.id === connectingFrom.nodeId);
    const draggedNodeData = draggedNode?.data as BuilderNodeData | undefined;
    if (!draggedNodeData?.schemaPath) {
      return new Set<string>();
    }

    let validIds: string[] = [];

    if (connectingFrom.handleType === 'source') {
      // Dragging from a source handle (right side) - find valid targets
      validIds = getValidTargets(
        connectingFrom.nodeId,
        connectingFrom.handleId,
        instancesMap,
        schemas,
        dataConnections
      );
    } else if (connectingFrom.handleType === 'target') {
      // Dragging from a target handle (left side) - find valid sources
      // These are nodes that have properties that can connect TO this node
      validIds = getValidSources(
        connectingFrom.nodeId,
        instancesMap,
        schemas,
        dataConnections
      );
    }
    
    return new Set(validIds);
  }, [connectingFrom, nodes, instancesMap, schemas, dataConnections]);

  // Update nodes with schemas prop and connected handles
  const nodesWithData = useMemo((): Node[] => {
    return nodes.map((node) => {
      const nodeData = node.data as unknown as BuilderNodeData;
      return {
        ...node,
        data: {
          ...nodeData,
          schemas,
          connectedHandles: connectedHandlesMap.get(node.id) || new Set(),
          isValidConnectionTarget: validTargetIds.has(node.id),
        } as BuilderNodeData,
      };
    });
  }, [nodes, schemas, connectedHandlesMap, validTargetIds]);

  // Handle value change from BuilderNode input fields
  const handleValueChange = useCallback((instanceId: string, propertyName: string, value: any) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === instanceId) {
          const nodeData = node.data as unknown as BuilderNodeData;
          return {
            ...node,
            data: {
              ...nodeData,
              values: {
                ...(nodeData.values || {}),
                [propertyName]: value,
              },
            } as BuilderNodeData,
          };
        }
        return node;
      })
    );
  }, [setNodes]);

  // Handle delete node
  const handleDeleteNode = useCallback((instanceId: string) => {
    // Remove the node
    setNodes((nds) => nds.filter((node) => node.id !== instanceId));
    // Remove any edges connected to this node
    setEdges((eds) => eds.filter((edge) => edge.source !== instanceId && edge.target !== instanceId));
  }, [setNodes, setEdges]);

  // Update nodes with schemas prop, connected handles, and value change handler
  const nodesWithDataAndHandlers = useMemo((): Node[] => {
    return nodesWithData.map((node) => {
      const nodeData = node.data as unknown as BuilderNodeData;
      return {
        ...node,
        data: {
          ...nodeData,
          onValueChange: handleValueChange,
          onDeleteNode: handleDeleteNode,
        } as BuilderNodeData,
      };
    });
  }, [nodesWithData, handleValueChange, handleDeleteNode]);

  // Handle keyboard shortcuts (Delete, Ctrl+C, Ctrl+V)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't handle if focus is in an input field
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return;
      }

      const selectedNodes = nodes.filter((node) => node.selected);
      const selectedEdges = edges.filter((edge) => edge.selected);

      // Delete key - delete selected nodes/edges or hovered edge
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedNodes.length > 0 || selectedEdges.length > 0) {
          event.preventDefault();
          const selectedNodeIds = new Set(selectedNodes.map((n) => n.id));
          // Remove selected nodes
          setNodes((nds) => nds.filter((node) => !node.selected));
          // Remove selected edges and edges connected to deleted nodes
          setEdges((eds) => eds.filter((edge) => 
            !edge.selected && 
            !selectedNodeIds.has(edge.source) && 
            !selectedNodeIds.has(edge.target)
          ));
        } else if (hoveredEdgeId) {
          // Delete hovered edge if no selection
          event.preventDefault();
          setEdges((eds) => eds.filter((edge) => edge.id !== hoveredEdgeId));
          setHoveredEdgeId(null);
        }
      }

      // Ctrl+C - copy selected nodes
      if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
        if (selectedNodes.length > 0) {
          event.preventDefault();
          setClipboard(selectedNodes.map((node) => ({ ...node })));
        }
      }

      // Ctrl+V - paste copied nodes
      if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
        if (clipboard.length > 0) {
          event.preventDefault();
          const newNodes: Node[] = clipboard.map((node) => {
            const nodeData = node.data as BuilderNodeData;
            const newInstanceId = generateInstanceId(nodeData.schemaPath);
            return {
              ...node,
              id: newInstanceId,
              position: {
                x: node.position.x + 50,
                y: node.position.y + 50,
              },
              selected: false,
              data: {
                ...nodeData,
                instanceId: newInstanceId,
                label: `${nodeData.schemaTitle} (${newInstanceId})`,
              },
            };
          });
          setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), ...newNodes]);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [nodes, edges, clipboard, hoveredEdgeId, setNodes, setEdges, setClipboard]);

  const handleClearCanvas = useCallback(() => {
    setNodes([]);
    setEdges([]);
    resetInstanceCounters();
    clearBuilderState();
  }, [setNodes, setEdges]);

  const handleAutoLayout = useCallback(async () => {
    if (nodes.length === 0) return;

    // Use ELK for automatic layout
    const elk = await import('elkjs/lib/elk.bundled');
    const elkInstance = new elk.default();

    // Calculate node dimensions based on content
    const elkGraph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.spacing.nodeNode': '50',
        'elk.layered.spacing.nodeNodeBetweenLayers': '100',
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
        'elk.edgeRouting': 'ORTHOGONAL',
      },
      children: nodes.map((node) => {
        const nodeData = node.data as BuilderNodeData;
        // Estimate height based on node content
        const schema = schemas[nodeData.schemaPath];
        const rules = schema ? getSchemaConnectionRules(schema, nodeData.schemaPath) : [];
        const propCount = rules.length;
        const inputCount = schema && (schema as any).properties 
          ? Object.keys((schema as any).properties).length - propCount 
          : 0;
        const height = 60 + (propCount * 36) + (inputCount * 50);
        
        return {
          id: node.id,
          width: 260,
          height: Math.max(100, height),
        };
      }),
      edges: edges.map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
      })),
    };

    try {
      const layout = await elkInstance.layout(elkGraph);
      
      setNodes((nds) =>
        nds.map((node) => {
          const layoutNode = layout.children?.find((n) => n.id === node.id);
          if (layoutNode) {
            return {
              ...node,
              position: {
                x: layoutNode.x || node.position.x,
                y: layoutNode.y || node.position.y,
              },
            };
          }
          return node;
        })
      );

      // Fit view after layout
      setTimeout(() => {
        if (reactFlowInstance) {
          reactFlowInstance.fitView({ padding: 0.2, duration: 300 });
        }
      }, 50);
    } catch (error) {
      console.error('Auto-layout failed:', error);
    }
  }, [nodes, edges, schemas, setNodes, reactFlowInstance]);

  const handleExportJson = useCallback(() => {
    if (nodes.length === 0) {
      console.log('No nodes to export');
      return;
    }

    try {
      const exportedData = exportToJson(nodes, edges, schemas);
      const jsonString = JSON.stringify(exportedData, null, 2);
      downloadFile(jsonString, 'data-model.json', 'application/json');
      console.log('Data model exported successfully');
    } catch (error) {
      console.error('Failed to export data model:', error);
    }
  }, [nodes, edges, schemas]);

  const onInit = useCallback((instance: ReactFlowInstance) => {
    setReactFlowInstance(instance);
  }, []);

  // Handle edge hover for keyboard deletion
  const onEdgeMouseEnter = useCallback((_: React.MouseEvent, edge: Edge) => {
    setHoveredEdgeId(edge.id);
  }, []);

  const onEdgeMouseLeave = useCallback(() => {
    setHoveredEdgeId(null);
  }, []);

  // Handle connection start - track which handle we're connecting from
  const onConnectStart = useCallback((_: React.MouseEvent | React.TouchEvent, params: OnConnectStartParams) => {
    setConnectingFrom(params);
  }, []);

  // Handle connection end - reset connecting state
  const onConnectEnd = useCallback(() => {
    setConnectingFrom(null);
  }, []);

  // Handle connection - validate and create edge
  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || !connection.sourceHandle) {
      console.warn('Invalid connection: missing source, target, or sourceHandle');
      return;
    }

    // Validate the connection using our validator
    const validationResult = validateConnection(
      connection.source,
      connection.target,
      connection.sourceHandle,
      dataConnections,
      schemas,
      instancesMap
    );

    if (!validationResult.valid) {
      console.warn(`Connection rejected: ${validationResult.reason}`);
      return;
    }

    // Get the source schema to determine edge style
    const sourceInstance = instancesMap.get(connection.source);
    const sourceSchema = sourceInstance ? schemas[sourceInstance.schemaPath] : null;
    let isArrayConnection = false;
    
    if (sourceSchema) {
      const rules = getSchemaConnectionRules(sourceSchema, sourceInstance!.schemaPath);
      const rule = rules.find(r => r.propertyPath === connection.sourceHandle);
      isArrayConnection = rule?.cardinality === 'many';
    }

    // Create the edge with proper styling
    const newEdge = {
      id: `${connection.source}-${connection.sourceHandle}-${connection.target}`,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle || 'target',
      type: 'default',
      animated: false,
      style: {
        stroke: isArrayConnection ? '#ffa726' : '#61dafb',
        strokeWidth: 2,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: isArrayConnection ? '#ffa726' : '#61dafb',
      },
      label: connection.sourceHandle,
      labelStyle: {
        fill: '#ccc',
        fontSize: 10,
      },
      labelBgStyle: {
        fill: '#1e1e1e',
        fillOpacity: 0.8,
      },
    };

    setEdges((eds) => addEdge(newEdge, eds));
  }, [dataConnections, schemas, instancesMap, setEdges]);

  // Handle drag over for the ReactFlow canvas
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  // Handle drop from the schema palette
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const schemaPath = event.dataTransfer.getData('application/schema-path');
      if (!schemaPath || !reactFlowInstance) {
        return;
      }

      // Get the schema info for the label
      const schemaInfo = schemaInfoMap.get(schemaPath);
      if (!schemaInfo) {
        console.warn(`Schema not found for path: ${schemaPath}`);
        return;
      }

      // Convert screen coordinates to flow coordinates
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      // Generate unique instance ID
      const instanceId = generateInstanceId(schemaPath);

      // Create new node with BuilderNode type
      const newNode: Node = {
        id: instanceId,
        type: 'builderNode',
        position,
        data: {
          label: `${schemaInfo.title} (${instanceId})`,
          schemaPath,
          instanceId,
          schemaTitle: schemaInfo.title,
          schemas,
        } as BuilderNodeData,
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [reactFlowInstance, schemaInfoMap, setNodes, schemas]
  );

  const hasNodes = nodes.length > 0;

  return (
    <div className="data-model-builder">
      <div className="builder-toolbar">
        <span className="builder-toolbar-title">Data Model Builder</span>
        <div className="builder-toolbar-divider" />
        <button
          className="builder-toolbar-btn danger"
          onClick={handleClearCanvas}
          disabled={!hasNodes}
          title="Clear all nodes and edges from canvas"
        >
          <Trash2 size={16} />
          Clear Canvas
        </button>
        <button
          className="builder-toolbar-btn"
          onClick={handleAutoLayout}
          disabled={!hasNodes}
          title="Auto-arrange nodes on canvas"
        >
          <Layout size={16} />
          Auto Layout
        </button>
        <button
          className="builder-toolbar-btn"
          onClick={handleExportJson}
          disabled={!hasNodes}
          title="Export data model as JSON"
        >
          <Download size={16} />
          Export JSON
        </button>
      </div>
      <div className="builder-main">
        <SchemaPalette schemas={schemas} />
        <div 
          className="builder-canvas" 
          ref={reactFlowWrapper}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <ReactFlow
            nodes={nodesWithDataAndHandlers}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onEdgeMouseEnter={onEdgeMouseEnter}
            onEdgeMouseLeave={onEdgeMouseLeave}
            onInit={onInit}
            minZoom={0.1}
            maxZoom={2}
            fitView
            proOptions={proOptions}
            connectionLineStyle={{ stroke: '#61dafb', strokeWidth: 2 }}
            defaultEdgeOptions={{
              style: { stroke: '#61dafb', strokeWidth: 2 },
              markerEnd: { type: MarkerType.ArrowClosed, color: '#61dafb' },
            }}
          >
            <Background />
            <Controls />
            <MiniMap
              pannable
              zoomable
              nodeColor="#61dafb"
              maskColor="rgba(0, 0, 0, 0.8)"
              style={{
                backgroundColor: '#0f0f0f',
                border: '1px solid #61dafb',
              }}
            />
          </ReactFlow>
          {!hasNodes && (
            <div className="builder-empty-state">
              <Boxes className="builder-empty-state-icon" />
              <h3 className="builder-empty-state-title">Build Your Data Model</h3>
              <p className="builder-empty-state-message">
                Drag schemas from the palette to build your data model
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DataModelBuilder;
