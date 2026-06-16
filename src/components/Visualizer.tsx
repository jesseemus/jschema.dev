import React, { useState } from 'react';
import ReactFlow, {
    Background,
    Controls,
    type Node,
    type Edge,
    MiniMap,
    type OnNodesChange,
    type OnEdgesChange,
    type ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { GoChevronDown, GoChevronUp } from 'react-icons/go';

interface VisualizerProps {
    nodes: Node[];
    edges: Edge[];
    onNodesChange: OnNodesChange;
    onEdgesChange: OnEdgesChange;
    nodeTypes?: any;
    onNodeClick?: (event: React.MouseEvent, node: Node) => void;
    onPaneClick?: () => void;
    onInit?: (instance: ReactFlowInstance) => void;
    selectedEntityType?: string | null;
    onEntityTypeClick?: (entityType: string) => void;
}

const stringToColor = (str: string): string => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const goldenRatio = 0.618033988749895;
    const hue = (Math.abs(hash) * goldenRatio * 360) % 360;
    const saturation = 70 + (Math.abs(hash >> 8) % 25);
    const lightness = 50 + (Math.abs(hash >> 16) % 20);
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

const proOptions = { hideAttribution: false };

export const Visualizer: React.FC<VisualizerProps> = ({
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    nodeTypes,
    onNodeClick,
    onPaneClick,
    onInit,
    selectedEntityType,
    onEntityTypeClick
}) => {
    const [isEntityTypesMinimized, setIsEntityTypesMinimized] = useState(false);
    const entityTypes = React.useMemo(() => {
        const types = new Map<string, { isRoot: boolean }>();
        nodes.forEach(node => {
            const entityType = node.data.entityType;
            const isRoot = node.data.isRoot;
            if (entityType && !types.has(entityType)) {
                types.set(entityType, { isRoot: isRoot || false });
            }
        });
        return Array.from(types.entries())
            .sort((a, b) => {
                if (a[1].isRoot !== b[1].isRoot) return a[1].isRoot ? -1 : 1;
                return a[0].localeCompare(b[0]);
            });
    }, [nodes]);

    return (
        <div style={{ height: '100%', width: '100%', position: 'relative' }}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                onNodeClick={onNodeClick}
                onPaneClick={onPaneClick}
                onInit={onInit}
                minZoom={0.05}
                maxZoom={2}
                nodesConnectable={false}
                proOptions={proOptions}
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

            <div className="legend-relationships" style={{
                position: 'absolute',
                bottom: '20px',
                left: 'calc(10px + 50px + 10px)',
                backgroundColor: 'rgba(37, 37, 38, 0.95)',
                border: '1px solid #444',
                borderRadius: '6px',
                padding: '10px 12px',
                fontSize: '0.75rem',
                color: '#ccc',
                zIndex: 1,
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                minHeight: '69px'
            }}>
                <div style={{ fontWeight: 'bold', marginBottom: '6px', color: '#fff', fontSize: '0.85rem' }}>Relationships</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <div style={{ width: '24px', height: '1.5px', backgroundColor: '#61dafb' }}></div>
                    <span>One-to-One</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <div style={{ width: '24px', height: '2px', backgroundColor: '#ff9800' }}></div>
                    <span>One-to-Many</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '24px', height: '2.5px', backgroundColor: '#19ca31ff' }}></div>
                    <span>Multiple Refs</span>
                </div>
            </div>

            {entityTypes.length > 0 && (
                <div className="legend-entity-types" style={{
                    position: 'absolute',
                    bottom: '20px',
                    left: 'calc(10px + 50px + 10px + 165px + 10px)',
                    backgroundColor: 'rgba(37, 37, 38, 0.95)',
                    border: '1px solid #444',
                    borderRadius: '6px',
                    padding: '10px 14px',
                    fontSize: '0.75rem',
                    color: '#ccc',
                    zIndex: 1,
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: isEntityTypesMinimized ? 'auto' : '69px'
                }}>
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '10px',
                        alignItems: 'center',
                        marginBottom: isEntityTypesMinimized ? '0' : '6px'
                    }}>
                        <div style={{ fontWeight: 'bold', color: '#fff', fontSize: '0.85rem' }}>Entity Types</div>
                        <button
                            onClick={() => setIsEntityTypesMinimized(!isEntityTypesMinimized)}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#ccc',
                                cursor: 'pointer',
                                padding: '2px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                        >
                            {isEntityTypesMinimized ? <GoChevronUp size={14} /> : <GoChevronDown size={14} />}
                        </button>
                    </div>
                    {!isEntityTypesMinimized && (
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(5, auto 1fr)',
                            gap: '3px 10px',
                            alignItems: 'center',
                            columnGap: '16px',
                            flex: 1,
                            alignContent: 'start'
                        }}>
                            {entityTypes.map(([type, { isRoot }]) => {
                                const isSelected = selectedEntityType === type;
                                return (
                                    <React.Fragment key={type}>
                                        <div
                                            style={{
                                                width: '10px',
                                                height: '10px',
                                                backgroundColor: isRoot ? '#4CAF50' : stringToColor(type),
                                                borderRadius: '2px',
                                                cursor: 'pointer',
                                                opacity: isSelected ? 1 : 0.8,
                                                transform: isSelected ? 'scale(1.2)' : 'scale(1)',
                                                transition: 'all 0.2s'
                                            }}
                                            onClick={() => onEntityTypeClick?.(type)}
                                        ></div>
                                        <span
                                            style={{
                                                textTransform: 'capitalize',
                                                fontSize: '0.75rem',
                                                whiteSpace: 'nowrap',
                                                cursor: 'pointer',
                                                fontWeight: isSelected ? 'bold' : 'normal',
                                                color: isSelected ? '#fff' : '#ccc',
                                                transition: 'all 0.2s'
                                            }}
                                            onClick={() => onEntityTypeClick?.(type)}
                                        >{type}{isRoot ? ' (Root)' : ''}</span>
                                    </React.Fragment>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div >
    );
};
