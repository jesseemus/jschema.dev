import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  useNodesState,
  useEdgesState,
  type Node,
  type ReactFlowInstance,
} from 'reactflow';
import { JsonEditor, MultiSchemaEditor } from './components/Editor';
import { Visualizer } from './components/Visualizer';
import { SchemaNode } from './components/SchemaNode';
import { Layout, Loader2, X, ChevronLeft, ChevronRight, Home, ArrowDown, Download, Upload } from 'lucide-react';
import JSZip from 'jszip';
import './App.css';
import { schemaToGraph, layoutGraph } from './utils/graphUtils';
import { fetchSchemaList, fetchRawSchema, fetchAndResolveSchema, type SchemaFile } from './utils/schemaLoader';
import { extractSchemaReferences, createSchemaGraph, type SchemaRelationship } from './utils/schemaRelationships';
import { editorStorage } from './utils/editorStorage';

// Debounce helper
function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): T {
  let timeoutId: ReturnType<typeof setTimeout>;
  return ((...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  }) as T;
}

// Example schemas to load on startup
const EXAMPLE_SCHEMAS: { path: string; url: string }[] = [
  { path: 'v1/user/user.schema.json', url: '/example-schemas/v1/user/user.schema.json' },
  { path: 'v1/profile/profile.schema.json', url: '/example-schemas/v1/profile/profile.schema.json' },
  { path: 'v1/role/role.schema.json', url: '/example-schemas/v1/role/role.schema.json' },
  { path: 'v1/permission/permission.schema.json', url: '/example-schemas/v1/permission/permission.schema.json' },
  { path: 'v1/address/address.schema.json', url: '/example-schemas/v1/address/address.schema.json' },
  { path: 'v1/country/country.schema.json', url: '/example-schemas/v1/country/country.schema.json' },
  { path: 'v1/phone/phone.schema.json', url: '/example-schemas/v1/phone/phone.schema.json' },
  { path: 'v1/currency/currency.schema.json', url: '/example-schemas/v1/currency/currency.schema.json' },
  { path: 'v1/settings/user-settings.schema.json', url: '/example-schemas/v1/settings/user-settings.schema.json' },
  { path: 'v1/notification/notification-settings.schema.json', url: '/example-schemas/v1/notification/notification-settings.schema.json' },
  { path: 'v1/privacy/privacy-settings.schema.json', url: '/example-schemas/v1/privacy/privacy-settings.schema.json' },
];

const nodeTypes = {
  schemaNode: SchemaNode,
};

function App() {
  const [schema, setSchema] = useState<string>('// Loading example schemas...');
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(true);
  const [schemaList, setSchemaList] = useState<SchemaFile[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [schemasMap, setSchemasMap] = useState<Map<string, any>>(new Map());
  const [autoLoadedFromUrl, setAutoLoadedFromUrl] = useState(false);
  const [allRelationships, setAllRelationships] = useState<SchemaRelationship[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEntityType, setSelectedEntityType] = useState<string | null>(null);
  const [isEditorMinimized, setIsEditorMinimized] = useState(window.innerWidth <= 768);
  const [viewMode, setViewMode] = useState<'single' | 'multi'>('multi');
  const [selectedSchemaPath, setSelectedSchemaPath] = useState<string | null>(null);
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);

  type NavigationState = {
    label: string;
    schema: string;
    nodes: Node[];
    edges: any[];
    viewMode: 'single' | 'multi';
    schemasMap?: Map<string, any>;
    allRelationships?: SchemaRelationship[];
  };
  const [navigationHistory, setNavigationHistory] = useState<NavigationState[]>([]);

  const highlightedEdges = useMemo(() => {
    if (!selectedNodeId && !selectedEntityType) return edges;

    return edges.map(edge => {
      let isConnected = false;

      if (selectedNodeId) {
        isConnected = edge.source === selectedNodeId || edge.target === selectedNodeId;
      } else if (selectedEntityType) {
        const sourceNode = nodes.find(n => n.id === edge.source);
        const targetNode = nodes.find(n => n.id === edge.target);
        isConnected = sourceNode?.data.entityType === selectedEntityType ||
          targetNode?.data.entityType === selectedEntityType;
      }

      const originalColor = edge.style?.stroke || '#61dafb';
      const originalWidth = typeof edge.style?.strokeWidth === 'number' ? edge.style.strokeWidth : 1;

      return {
        ...edge,
        animated: isConnected,
        style: {
          ...edge.style,
          stroke: originalColor,
          strokeWidth: isConnected ? originalWidth * 2.5 : originalWidth,
          opacity: isConnected ? 1 : 0.15,
        }
      };
    });
  }, [edges, selectedNodeId, selectedEntityType, nodes]);

  const updateGraph = useCallback(async (schemaStr: string) => {
    try {
      const parsed = JSON.parse(schemaStr);
      const { nodes: rawNodes, edges: rawEdges } = schemaToGraph(parsed);
      const { nodes: layoutedNodes, edges: layoutedEdges } = await layoutGraph(rawNodes, rawEdges);
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
    } catch (e) {
    }
  }, [setNodes, setEdges]);

  // Debounced schema change handler for multi-mode editor
  const handleMultiSchemaChange = useCallback((path: string, content: string) => {
    try {
      const parsed = JSON.parse(content);
      setSchemasMap((prevMap) => {
        const newMap = new Map(prevMap);
        newMap.set(path, parsed);
        
        // Re-extract relationships and update graph
        const allRefs: SchemaRelationship[] = [];
        newMap.forEach((schemaData, schemaName) => {
          const refs = extractSchemaReferences(schemaData, schemaName);
          allRefs.push(...refs);
        });
        setAllRelationships(allRefs);
        
        // Update the graph
        const { nodes: rawNodes, edges: rawEdges } = createSchemaGraph(newMap, allRefs, expandedNodes);
        layoutGraph(rawNodes, rawEdges).then(({ nodes: layoutedNodes, edges: layoutedEdges }) => {
          setNodes(layoutedNodes);
          setEdges(layoutedEdges);
        });
        
        return newMap;
      });
    } catch (e) {
      // Invalid JSON, don't update
    }
  }, [expandedNodes, setNodes, setEdges]);

  const debouncedMultiSchemaChange = useMemo(
    () => debounce(handleMultiSchemaChange, 500),
    [handleMultiSchemaChange]
  );

  useEffect(() => {
    if (viewMode === 'single') {
      updateGraph(schema);
    }
  }, [schema, updateGraph, viewMode]);

  // Load example schemas on startup (if no URL param)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlParam = params.get('url');
    
    // Skip if loading from URL
    if (urlParam) return;
    
    const loadExampleSchemas = async () => {
      setLoading(true);
      try {
        const newSchemasMap = new Map<string, any>();
        const allRefs: SchemaRelationship[] = [];
        
        // Load all example schemas
        for (const schemaInfo of EXAMPLE_SCHEMAS) {
          try {
            const response = await fetch(schemaInfo.url);
            if (response.ok) {
              const schemaData = await response.json();
              newSchemasMap.set(schemaInfo.path, schemaData);
              const refs = extractSchemaReferences(schemaData, schemaInfo.path);
              allRefs.push(...refs);
            }
          } catch (e) {
            console.error(`Failed to load ${schemaInfo.path}:`, e);
          }
        }
        
        if (newSchemasMap.size > 0) {
          setSchemasMap(newSchemasMap);
          setAllRelationships(allRefs);
          
          // Create and layout the graph
          const { nodes: rawNodes, edges: rawEdges } = createSchemaGraph(newSchemasMap, allRefs, expandedNodes);
          const { nodes: layoutedNodes, edges: layoutedEdges } = await layoutGraph(rawNodes, rawEdges);
          
          setNodes(layoutedNodes);
          setEdges(layoutedEdges);
          
          const summary = `// Loaded ${newSchemasMap.size} example schemas\n// Found ${allRefs.length} $ref relationships\n\n` +
            `Schemas:\n${Array.from(newSchemasMap.keys()).map(name => `- ${name}`).join('\n')}`;
          setSchema(summary);
          
          setTimeout(() => {
            if (reactFlowInstance.current) {
              reactFlowInstance.current.fitView({ padding: 0.2, duration: 300 });
            }
          }, 100);
        }
      } catch (e) {
        console.error('Failed to load example schemas:', e);
      } finally {
        setLoading(false);
      }
    };
    
    loadExampleSchemas();
  }, []); // Run once on mount

  useEffect(() => {
    if (autoLoadedFromUrl) return;

    const params = new URLSearchParams(window.location.search);
    const urlParam = params.get('url');

    if (urlParam) {
      setAutoLoadedFromUrl(true);
      setBaseUrl(urlParam);

      const loadFromUrl = async () => {
        setLoading(true);
        try {
          const list = await fetchSchemaList(urlParam);
          setSchemaList(list);

          const schemasMap = new Map<string, any>();
          const allRelationships: SchemaRelationship[] = [];

          for (const file of list) {
            try {
              const rawSchema = await fetchRawSchema(file.url);
              schemasMap.set(file.name, rawSchema);
              const refs = extractSchemaReferences(rawSchema, file.name);
              allRelationships.push(...refs);
            } catch (e) {
              console.error(`Failed to load ${file.name}:`, e);
            }
          }

          setSchemasMap(schemasMap);
          setAllRelationships(allRelationships);

          const { nodes: rawNodes, edges: rawEdges } = createSchemaGraph(schemasMap, allRelationships, new Set());
          const { nodes: layoutedNodes, edges: layoutedEdges } = await layoutGraph(rawNodes, rawEdges);

          setNodes(layoutedNodes);
          setEdges(layoutedEdges);

          const summary = `// Loaded ${schemasMap.size} schemas\n// Found ${allRelationships.length} $ref relationships\n\n` +
            `Schemas:\n${Array.from(schemasMap.keys()).map(name => `- ${name}`).join('\n')}`;
          setSchema(summary);
          setViewMode('multi');

          setTimeout(() => {
            if (reactFlowInstance.current) {
              reactFlowInstance.current.fitView({ padding: 0.2, duration: 300 });
            }
          }, 100);
        } catch (e: any) {
          const message = e?.message || 'Failed to load schemas from URL parameter';
          alert(`Error: ${message}`);
        } finally {
          setLoading(false);
        }
      };

      loadFromUrl();
    }
  }, [autoLoadedFromUrl]);

  const handleEditorChange = (value: string | undefined) => {
    if (value) {
      setSchema(value);
    }
  };

  const handleEditorClick = useCallback((property: string) => {
    setNodes((currentNodes) => {
      console.log('handleEditorClick called with:', property);
      console.log('ReactFlow instance:', reactFlowInstance.current);
      console.log('Available nodes:', currentNodes.map(n => ({ id: n.id, label: n.data.label, schemaName: n.data.schemaName })));

      if (reactFlowInstance.current && currentNodes.length > 0) {
        const matchingNode = currentNodes.find(node =>
          node.id === property ||
          node.id.endsWith(property) ||
          node.id.endsWith('/' + property) ||
          node.id.toLowerCase().includes(property.toLowerCase()) ||
          node.data.schemaName === property ||
          node.data.schemaName?.endsWith(property) ||
          node.data.schemaName?.endsWith('/' + property) ||
          node.data.label?.toLowerCase().includes(property.toLowerCase())
        );

        console.log('Matching node found:', matchingNode);

        if (matchingNode) {
          console.log('Centering on node:', matchingNode.id, 'at position:', matchingNode.position);
          reactFlowInstance.current.setCenter(
            matchingNode.position.x + 100,
            matchingNode.position.y + 40,
            { zoom: 1, duration: 800 }
          );
          setSelectedNodeId(matchingNode.id);
        } else {
          console.log('No matching node found for:', property);
          console.log('Tried to match:', property);
        }
      } else {
        console.log('Conditions not met - instance:', !!reactFlowInstance.current, 'nodes:', currentNodes.length);
      }

      return currentNodes;
    });
  }, []);

  const handleLoadRemote = async () => {
    setShowUrlInput(true);
  };

  const handleFetchSchemas = async () => {
    setLoading(true);
    setShowUrlInput(false);

    try {
      try {
        const list = await fetchSchemaList(baseUrl);
        setSchemaList(list);
        setShowModal(true);
      } catch (listError) {
        console.log('Not a list URL, trying as direct schema');
        const resolved = await fetchAndResolveSchema(baseUrl);
        setSchema(JSON.stringify(resolved, null, 2));
        setViewMode('single');
      }
    } catch (e: any) {
      const message = e?.message || 'Failed to load schema';
      alert(`Error: ${message}\n\nPlease check the URL and ensure CORS is enabled.`);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSchema = async (url: string) => {
    setLoading(true);
    setShowModal(false);
    try {
      const resolved = await fetchAndResolveSchema(url);
      setSchema(JSON.stringify(resolved, null, 2));
      setViewMode('single');
    } catch (e: any) {
      const message = e?.message || 'Failed to load/resolve schema';
      alert(`Error: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadAllSchemas = async () => {
    if (schemaList.length === 0) {
      alert('Please load the schema list first');
      return;
    }

    setLoading(true);
    setShowModal(false);

    try {
      const schemasMap = new Map<string, any>();
      const allRelationships: SchemaRelationship[] = [];

      for (const file of schemaList) {
        try {
          const rawSchema = await fetchRawSchema(file.url);
          schemasMap.set(file.name, rawSchema);

          const refs = extractSchemaReferences(rawSchema, file.name);
          allRelationships.push(...refs);
        } catch (e) {
          console.error(`Failed to load ${file.name}:`, e);
        }
      }

      setSchemasMap(schemasMap);
      setAllRelationships(allRelationships);

      const { nodes: rawNodes, edges: rawEdges } = createSchemaGraph(schemasMap, allRelationships, expandedNodes);
      const { nodes: layoutedNodes, edges: layoutedEdges } = await layoutGraph(rawNodes, rawEdges);

      const nodesWithHandlers = layoutedNodes.map(node => ({
        ...node,
        data: {
          ...node.data,
          onToggle: () => handleToggleNode(node.id),
          isSelected: false,
          isEntityTypeSelected: false
        }
      }));

      setNodes(nodesWithHandlers);
      setEdges(layoutedEdges);

      const summary = `// Loaded ${schemasMap.size} schemas\n// Found ${allRelationships.length} $ref relationships\n\n` +
        `Schemas:\n${Array.from(schemasMap.keys()).map(name => `- ${name}`).join('\n')}`;
      setSchema(summary);
      setViewMode('multi');

      setTimeout(() => {
        if (reactFlowInstance.current) {
          reactFlowInstance.current.fitView({ padding: 0.2, duration: 300 });
        }
      }, 100);

    } catch (e: any) {
      const message = e?.message || 'Failed to load all schemas';
      alert(`Error: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleNode = useCallback((nodeId: string) => {
    console.log('handleToggleNode called with:', nodeId);

    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
      console.log('Collapsing node');
    } else {
      newExpanded.add(nodeId);
      console.log('Expanding node');
    }
    setExpandedNodes(newExpanded);

    setNodes((currentNodes) =>
      currentNodes.map(node => ({
        ...node,
        data: {
          ...node.data,
          isExpanded: newExpanded.has(node.id),
          onToggle: () => handleToggleNode(node.id),
          isSelected: node.id === selectedNodeId,
          isEntityTypeSelected: selectedEntityType ? node.data.entityType === selectedEntityType : false
        }
      }))
    );
  }, [expandedNodes, selectedNodeId, selectedEntityType]);

  useEffect(() => {
    if (nodes.length > 0) {
      const connectedNodeIds = new Set<string>();

      if (selectedNodeId || selectedEntityType) {
        edges.forEach(edge => {
          if (selectedNodeId) {
            if (edge.source === selectedNodeId) {
              connectedNodeIds.add(edge.target);
            }
            if (edge.target === selectedNodeId) {
              connectedNodeIds.add(edge.source);
            }
          } else if (selectedEntityType) {
            const sourceNode = nodes.find(n => n.id === edge.source);
            const targetNode = nodes.find(n => n.id === edge.target);
            const sourceMatches = sourceNode?.data.entityType === selectedEntityType;
            const targetMatches = targetNode?.data.entityType === selectedEntityType;

            if (sourceMatches) {
              connectedNodeIds.add(edge.target);
            }
            if (targetMatches) {
              connectedNodeIds.add(edge.source);
            }
          }
        });
      }

      setNodes((currentNodes) =>
        currentNodes.map(node => ({
          ...node,
          data: {
            ...node.data,
            isSelected: selectedNodeId ? node.id === selectedNodeId : undefined,
            isEntityTypeSelected: selectedEntityType ? node.data.entityType === selectedEntityType : undefined,
            isConnected: connectedNodeIds.has(node.id)
          }
        }))
      );
    }
  }, [selectedNodeId, selectedEntityType, edges]);

  useEffect(() => {
    if (nodes.length > 0 && viewMode === 'multi') {
      setNodes((currentNodes) =>
        currentNodes.map(node => ({
          ...node,
          data: {
            ...node.data,
            onToggle: () => handleToggleNode(node.id)
          }
        }))
      );
    }
  }, [handleToggleNode, viewMode]);

  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    console.log('Node clicked for selection:', node.id);
    console.log('Current viewMode before click:', viewMode);
    setSelectedNodeId(node.id);
    setSelectedEntityType(null);

    if (node.data.schemaData) {
      setSchema(JSON.stringify(node.data.schemaData, null, 2));
      console.log('After setting schema, viewMode should still be:', viewMode);
    }

    // In multi-mode, find and open the corresponding schema file
    if (viewMode === 'multi' && node.data.schemaName) {
      // Find the schema path in schemasMap that matches this node
      const schemaName = node.data.schemaName;
      const matchingPath = Array.from(schemasMap.keys()).find(path => 
        path === schemaName || 
        path.endsWith('/' + schemaName) ||
        path.endsWith(schemaName)
      );
      if (matchingPath) {
        setSelectedSchemaPath(matchingPath);
      }
    }
  }, [viewMode, schemasMap]);

  const handlePaneClick = useCallback(() => {
    console.log('Pane clicked, clearing selection');
    setSelectedNodeId(null);
    setSelectedEntityType(null);
    setSelectedEntityType(null);

    if (schemasMap.size > 0) {
      const summary = `// Loaded ${schemasMap.size} schemas\n// Found ${allRelationships.length} $ref relationships\n\n` +
        `Schemas:\n${Array.from(schemasMap.keys()).map(name => `- ${name}`).join('\n')}`;
      setSchema(summary);
    }
  }, [schemasMap, allRelationships]);

  const handleDrillDown = useCallback(async () => {
    if (!selectedNodeId) return;

    const selectedNode = nodes.find(n => n.id === selectedNodeId);
    if (!selectedNode || !selectedNode.data.schemaData) return;

    const currentState: NavigationState = {
      label: navigationHistory.length === 0 ? 'Root' : selectedNode.data.label || selectedNode.id,
      schema,
      nodes,
      edges,
      viewMode,
      schemasMap: schemasMap.size > 0 ? new Map(schemasMap) : undefined,
      allRelationships: allRelationships.length > 0 ? [...allRelationships] : undefined,
    };

    setNavigationHistory([...navigationHistory, currentState]);

    const schemaData = selectedNode.data.schemaData;
    const schemaStr = JSON.stringify(schemaData, null, 2);
    setSchema(schemaStr);

    try {
      const { nodes: rawNodes, edges: rawEdges } = schemaToGraph(schemaData);
      const { nodes: layoutedNodes, edges: layoutedEdges } = await layoutGraph(rawNodes, rawEdges);
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
      setViewMode('single');
      setSelectedNodeId(null);
      setSelectedEntityType(null);

      setTimeout(() => {
        if (reactFlowInstance.current) {
          reactFlowInstance.current.fitView({ padding: 0.2, duration: 300 });
        }
      }, 100);
    } catch (e) {
      console.error('Failed to generate graph for drilled-down schema:', e);
    }
  }, [selectedNodeId, nodes, schema, edges, viewMode, navigationHistory, schemasMap, allRelationships]);

  const handleNavigateBack = useCallback(async (index: number) => {
    if (index < 0 || index >= navigationHistory.length) return;

    const targetState = navigationHistory[index];

    setSchema(targetState.schema);
    setNodes(targetState.nodes);
    setEdges(targetState.edges);
    setViewMode(targetState.viewMode);

    if (targetState.schemasMap) {
      setSchemasMap(targetState.schemasMap);
    }
    if (targetState.allRelationships) {
      setAllRelationships(targetState.allRelationships);
    }

    setNavigationHistory(navigationHistory.slice(0, index));
    setSelectedNodeId(null);
    setSelectedEntityType(null);

    setTimeout(() => {
      if (reactFlowInstance.current) {
        reactFlowInstance.current.fitView({ padding: 0.2, duration: 300 });
      }
    }, 100);
  }, [navigationHistory]);

  const handleNavigateToRoot = useCallback(async () => {
    if (navigationHistory.length === 0) return;
    handleNavigateBack(0);
  }, [navigationHistory, handleNavigateBack]);

  const handleMoveFile = useCallback((oldPath: string, newPath: string) => {
    const schemaData = schemasMap.get(oldPath);
    if (!schemaData) return;
    
    const newMap = new Map(schemasMap);
    newMap.delete(oldPath);
    newMap.set(newPath, schemaData);
    setSchemasMap(newMap);
    
    // Update editorStorage
    const editedContent = editorStorage.loadAllEditedContent();
    if (editedContent[oldPath]) {
      editorStorage.saveEditedContent(newPath, editedContent[oldPath]);
      editorStorage.removeEditedContent(oldPath);
    }
    
    // Re-extract relationships and update graph
    const allRefs: SchemaRelationship[] = [];
    newMap.forEach((data, name) => {
      const refs = extractSchemaReferences(data, name);
      allRefs.push(...refs);
    });
    setAllRelationships(allRefs);
    
    // Update the graph
    const { nodes: rawNodes, edges: rawEdges } = createSchemaGraph(newMap, allRefs, expandedNodes);
    layoutGraph(rawNodes, rawEdges).then(({ nodes: layoutedNodes, edges: layoutedEdges }) => {
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
    });
  }, [schemasMap, expandedNodes, setNodes, setEdges]);

  const handleDeleteFile = useCallback((path: string) => {
    const newMap = new Map(schemasMap);
    
    // Check if this is a folder (path exists in schemasMap as prefix of other files)
    const isFolder = !schemasMap.has(path) && 
      Array.from(schemasMap.keys()).some(key => key.startsWith(path + '/'));
    
    if (isFolder) {
      // Delete all files in the folder
      Array.from(schemasMap.keys()).forEach(key => {
        if (key.startsWith(path + '/')) {
          newMap.delete(key);
          editorStorage.removeEditedContent(key);
        }
      });
    } else {
      // Delete single file
      newMap.delete(path);
      editorStorage.removeEditedContent(path);
    }
    
    setSchemasMap(newMap);
    
    // Re-extract relationships and update graph
    const allRefs: SchemaRelationship[] = [];
    newMap.forEach((data, name) => {
      const refs = extractSchemaReferences(data, name);
      allRefs.push(...refs);
    });
    setAllRelationships(allRefs);
    
    // Update the graph
    const { nodes: rawNodes, edges: rawEdges } = createSchemaGraph(newMap, allRefs, expandedNodes);
    layoutGraph(rawNodes, rawEdges).then(({ nodes: layoutedNodes, edges: layoutedEdges }) => {
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
    });
  }, [schemasMap, expandedNodes, setNodes, setEdges]);

  const handleCopyFile = useCallback((path: string) => {
    const schemaData = schemasMap.get(path);
    if (!schemaData) return;
    
    // Generate new filename
    const parts = path.split('/');
    const fileName = parts.pop() || path;
    const dir = parts.join('/');
    const baseName = fileName.replace(/\.schema\.json$/, '').replace(/\.json$/, '');
    let newName = `${baseName}-copy.schema.json`;
    let counter = 1;
    
    // Find unique name
    while (schemasMap.has(dir ? `${dir}/${newName}` : newName)) {
      newName = `${baseName}-copy-${counter}.schema.json`;
      counter++;
    }
    
    const newPath = dir ? `${dir}/${newName}` : newName;
    const newMap = new Map(schemasMap);
    newMap.set(newPath, JSON.parse(JSON.stringify(schemaData)));
    setSchemasMap(newMap);
    
    // Save to editorStorage
    editorStorage.saveEditedContent(newPath, JSON.stringify(schemaData, null, 2));
    
    // Re-extract relationships and update graph
    const allRefs: SchemaRelationship[] = [];
    newMap.forEach((data, name) => {
      const refs = extractSchemaReferences(data, name);
      allRefs.push(...refs);
    });
    setAllRelationships(allRefs);
    
    // Update the graph
    const { nodes: rawNodes, edges: rawEdges } = createSchemaGraph(newMap, allRefs, expandedNodes);
    layoutGraph(rawNodes, rawEdges).then(({ nodes: layoutedNodes, edges: layoutedEdges }) => {
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
    });
  }, [schemasMap, expandedNodes, setNodes, setEdges]);

  const handleClearAll = useCallback(() => {
    // Clear all schemas
    setSchemasMap(new Map());
    
    // Clear all edited content from storage
    schemasMap.forEach((_, path) => {
      editorStorage.removeEditedContent(path);
    });
    
    // Clear relationships
    setAllRelationships([]);
    
    // Clear the graph
    setNodes([]);
    setEdges([]);
  }, [schemasMap, setNodes, setEdges]);

  const handleExportSchemas = useCallback(async () => {
    if (schemasMap.size === 0) return;
    
    const zip = new JSZip();
    
    schemasMap.forEach((schemaData, path) => {
      const content = JSON.stringify(schemaData, null, 2);
      zip.file(path, content);
    });
    
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'schemas.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [schemasMap]);

  const handleImportSchemas = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setLoading(true);
    try {
      const zip = await JSZip.loadAsync(file);
      const newSchemasMap = new Map<string, any>();
      const allRefs: SchemaRelationship[] = [];
      
      const filePromises: Promise<void>[] = [];
      zip.forEach((relativePath, zipEntry) => {
        if (!zipEntry.dir && relativePath.endsWith('.json')) {
          filePromises.push(
            zipEntry.async('string').then((content) => {
              try {
                const parsed = JSON.parse(content);
                newSchemasMap.set(relativePath, parsed);
              } catch (e) {
                console.error(`Failed to parse ${relativePath}:`, e);
              }
            })
          );
        }
      });
      
      await Promise.all(filePromises);
      
      if (newSchemasMap.size === 0) {
        alert('No valid JSON schema files found in the ZIP');
        return;
      }
      
      // Extract relationships
      newSchemasMap.forEach((schemaData, schemaName) => {
        const refs = extractSchemaReferences(schemaData, schemaName);
        allRefs.push(...refs);
      });
      
      setSchemasMap(newSchemasMap);
      setAllRelationships(allRefs);
      
      // Create the graph
      const { nodes: rawNodes, edges: rawEdges } = createSchemaGraph(newSchemasMap, allRefs, new Set());
      const { nodes: layoutedNodes, edges: layoutedEdges } = await layoutGraph(rawNodes, rawEdges);
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
      
      // Update summary
      const summary = `// Imported ${newSchemasMap.size} schemas from ZIP\n// Found ${allRefs.length} $ref relationships\n\n` +
        `Schemas:\n${Array.from(newSchemasMap.keys()).map(name => `- ${name}`).join('\n')}`;
      setSchema(summary);
      setViewMode('multi');
      setExpandedNodes(new Set());
      setNavigationHistory([]);
      
      setTimeout(() => {
        if (reactFlowInstance.current) {
          reactFlowInstance.current.fitView({ padding: 0.2, duration: 300 });
        }
      }, 100);
    } catch (e) {
      console.error('Failed to import ZIP:', e);
      alert('Failed to import ZIP file. Make sure it contains valid JSON schema files.');
    } finally {
      setLoading(false);
      // Reset file input so the same file can be selected again
      event.target.value = '';
    }
  }, [setNodes, setEdges]);

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-left">
          <div className="logo">
            <Layout className="icon" />
            <span>JSON Schema Visualizer</span>
          </div>
          <button
            className="btn-icon"
            onClick={() => setIsEditorMinimized(!isEditorMinimized)}
            title={isEditorMinimized ? 'Show Editor' : 'Hide Editor'}
          >
            {isEditorMinimized ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
          </button>

          {navigationHistory.length > 0 && (
            <div className="breadcrumb-container">
              <button
                className="breadcrumb-item clickable"
                onClick={handleNavigateToRoot}
                title="Navigate to root"
              >
                <Home size={14} />
              </button>
              {navigationHistory.map((item, index) => (
                <div key={index} className="breadcrumb-wrapper">
                  <ChevronRight size={14} className="breadcrumb-separator" />
                  <button
                    className="breadcrumb-item clickable"
                    onClick={() => handleNavigateBack(index)}
                    title={`Navigate back to ${item.label}`}
                  >
                    {item.label}
                  </button>
                </div>
              ))}
              <ChevronRight size={14} className="breadcrumb-separator" />
              <span className="breadcrumb-item current">Current</span>
            </div>
          )}
        </div>
        <div className="actions">
          <a
            href="https://github.com/jesseemus/jschema.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-github"
            title="View on GitHub"
          >
            <svg width="20" height="20" viewBox="0 0 98 96" xmlns="http://www.w3.org/2000/svg">
              <path fillRule="evenodd" clipRule="evenodd" d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z" fill="currentColor"/>
            </svg>
          </a>
          <input
            type="file"
            id="import-zip-input"
            accept=".zip"
            style={{ display: 'none' }}
            onChange={handleImportSchemas}
          />
          <button
            className="btn-import"
            onClick={() => document.getElementById('import-zip-input')?.click()}
            title="Import schemas from ZIP"
            disabled={loading}
          >
            <Upload size={16} />
            Import ZIP
          </button>
          {schemasMap.size > 0 && (
            <button
              className="btn-export"
              onClick={handleExportSchemas}
              title="Export all schemas as ZIP"
            >
              <Download size={16} />
              Export ZIP
            </button>
          )}
          {selectedNodeId && (
            <button
              className="btn-drill-down"
              onClick={handleDrillDown}
              title="Drill down into this schema"
            >
              <ArrowDown size={16} />
              Drill Down
            </button>
          )}
          <button className="btn-primary" onClick={handleLoadRemote} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" size={16} /> : 'Get schema from URI'}
          </button>
        </div>
      </header>
      <main className="main-content">
        <div className={`editor-pane ${isEditorMinimized ? 'minimized' : ''} ${viewMode === 'multi' ? 'multi-mode' : ''}`}>
          {!isEditorMinimized && (
            viewMode === 'multi' && schemasMap.size > 0 ? (
              <MultiSchemaEditor 
                schemasMap={schemasMap} 
                onPropertyClick={handleEditorClick}
                onSchemaChange={debouncedMultiSchemaChange}
                onAddSchema={(path, content) => {
                  const newMap = new Map(schemasMap);
                  newMap.set(path, JSON.parse(content));
                  setSchemasMap(newMap);
                }}
                onMoveFile={handleMoveFile}
                onDeleteFile={handleDeleteFile}
                onCopyFile={handleCopyFile}
                onClearAll={handleClearAll}
                selectedSchemaPath={selectedSchemaPath}
                onFileSelect={(path) => {
                  // Zoom to the corresponding node when file is selected from explorer
                  const fileName = path.split('/').pop() || path;
                  handleEditorClick(fileName);
                }}
              />
            ) : (
              <JsonEditor 
                value={schema} 
                onChange={handleEditorChange} 
                onPropertyClick={handleEditorClick}
                schemasMap={schemasMap}
                onAddSchema={(path, content) => {
                  const newMap = new Map(schemasMap);
                  newMap.set(path, JSON.parse(content));
                  setSchemasMap(newMap);
                  // Save to editorStorage so it persists when switching to multi-mode
                  editorStorage.saveEditedContent(path, content);
                }}
                onMoveFile={handleMoveFile}
                onDeleteFile={handleDeleteFile}
                onCopyFile={handleCopyFile}
                onClearAll={handleClearAll}
                onSwitchToMultiMode={() => {
                  // First, sync current schema content back to schemasMap
                  // The 'example.schema.json' is the default file, or find the first entry
                  const updatedMap = new Map(schemasMap);
                  try {
                    const parsed = JSON.parse(schema);
                    // Update the first schema entry (usually example.schema.json) with current content
                    const firstKey = Array.from(schemasMap.keys())[0];
                    if (firstKey) {
                      updatedMap.set(firstKey, parsed);
                      editorStorage.saveEditedContent(firstKey, schema);
                    }
                  } catch (e) {
                    // If current schema isn't valid JSON (e.g., it's a summary), skip sync
                  }
                  
                  // Generate relationships and switch to multi-mode
                  const allRefs: SchemaRelationship[] = [];
                  updatedMap.forEach((schemaData, schemaName) => {
                    const refs = extractSchemaReferences(schemaData, schemaName);
                    allRefs.push(...refs);
                  });
                  setAllRelationships(allRefs);
                  setSchemasMap(updatedMap);
                  
                  // Create the graph
                  const { nodes: rawNodes, edges: rawEdges } = createSchemaGraph(updatedMap, allRefs, expandedNodes);
                  layoutGraph(rawNodes, rawEdges).then(({ nodes: layoutedNodes, edges: layoutedEdges }) => {
                    setNodes(layoutedNodes);
                    setEdges(layoutedEdges);
                    setViewMode('multi');
                    
                    const summary = `// Loaded ${updatedMap.size} schemas\n// Found ${allRefs.length} $ref relationships\n\n` +
                      `Schemas:\n${Array.from(updatedMap.keys()).map(name => `- ${name}`).join('\n')}`;
                    setSchema(summary);
                    
                    setTimeout(() => {
                      if (reactFlowInstance.current) {
                        reactFlowInstance.current.fitView({ padding: 0.2, duration: 300 });
                      }
                    }, 100);
                  });
                }}
              />
            )
          )}
        </div>
        <div className="visualizer-pane">
          <Visualizer
            nodes={nodes}
            edges={highlightedEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onNodeClick={handleNodeClick}
            onPaneClick={handlePaneClick}
            onInit={(instance) => { reactFlowInstance.current = instance; }}
            selectedEntityType={selectedEntityType}
            onEntityTypeClick={(entityType) => {
              setSelectedNodeId(null);
              setSelectedEntityType(entityType === selectedEntityType ? null : entityType);
            }}
          />
        </div>
      </main>

      {loading && (
        <div className="loading-overlay">
          <div className="loading-spinner">
            <Loader2 className="animate-spin" size={48} />
            <p>Loading schemas...</p>
          </div>
        </div>
      )}

      {showUrlInput && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Load Schema(s)</h3>
              <button onClick={() => setShowUrlInput(false)}><X size={20} /></button>
            </div>
            <div className="url-input-container">
              <label htmlFor="base-url">Schema URL:</label>
              <input
                id="base-url"
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://your-storage.blob.core.windows.net/schemas"
                className="url-input"
              />
              <small>
                Enter a URL to blob storage with the schemas
              </small>

              <button
                className="btn-primary"
                onClick={handleFetchSchemas}
                disabled={loading || !baseUrl}
                style={{ marginTop: '15px' }}
              >
                {loading ? <Loader2 className="animate-spin" size={16} /> : 'Load'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Select a Schema</h3>
              <button onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>
            <div className="schema-list-header">
              <button
                className="btn-secondary"
                onClick={handleLoadAllSchemas}
                disabled={loading}
                style={{ marginBottom: '10px', width: '100%' }}
              >
                {loading ? <Loader2 className="animate-spin" size={16} /> : 'Load All Schemas & Show Relationships'}
              </button>
            </div>
            <div className="schema-list">
              {schemaList.map((file) => (
                <div key={file.name} className="schema-item" onClick={() => handleSelectSchema(file.url)}>
                  <span className="schema-name">{file.name}</span>
                  <span className="schema-date">{file.lastModified}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
