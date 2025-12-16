/**
 * Persistence utilities for the Data Model Builder
 * Saves and loads builder state (nodes, edges, user values) to localStorage
 */

import type { Node, Edge } from 'reactflow';
import type { BuilderNodeData } from '../components/BuilderNode';

const STORAGE_KEY = 'jschema-builder-state';

/**
 * Serialized node format for storage (excludes transient data)
 */
export interface SerializedNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    schemaPath: string;
    instanceId: string;
    schemaTitle: string;
    values?: Record<string, any>;
  };
}

/**
 * Serialized edge format for storage
 */
export interface SerializedEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
}

/**
 * Complete builder state for persistence
 */
export interface BuilderState {
  nodes: SerializedNode[];
  edges: SerializedEdge[];
  lastSaved: string; // ISO timestamp
}

/**
 * Counter state extracted from nodes for restoring instance counters
 */
interface CounterState {
  [baseName: string]: number;
}

/**
 * Save the current builder state to localStorage
 * @param nodes - React Flow nodes array
 * @param edges - React Flow edges array
 */
export function saveBuilderState(nodes: Node[], edges: Edge[]): void {
  try {
    // Serialize nodes - only keep essential data
    const serializedNodes: SerializedNode[] = nodes.map((node) => {
      const nodeData = node.data as BuilderNodeData;
      return {
        id: node.id,
        type: node.type || 'builderNode',
        position: { x: node.position.x, y: node.position.y },
        data: {
          schemaPath: nodeData.schemaPath,
          instanceId: nodeData.instanceId,
          schemaTitle: nodeData.schemaTitle,
          values: nodeData.values,
        },
      };
    });

    // Serialize edges - only keep connection data
    const serializedEdges: SerializedEdge[] = edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || '',
      targetHandle: edge.targetHandle || 'target',
    }));

    const state: BuilderState = {
      nodes: serializedNodes,
      edges: serializedEdges,
      lastSaved: new Date().toISOString(),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Failed to save builder state:', error);
  }
}

/**
 * Load builder state from localStorage
 * @returns BuilderState if exists and valid, null otherwise
 */
export function loadBuilderState(): BuilderState | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return null;
    }

    const state = JSON.parse(stored) as BuilderState;

    // Validate the loaded state has required structure
    if (!state || !Array.isArray(state.nodes) || !Array.isArray(state.edges)) {
      console.warn('Invalid builder state structure, clearing');
      clearBuilderState();
      return null;
    }

    // Validate nodes have required properties
    for (const node of state.nodes) {
      if (!node.id || !node.position || !node.data?.schemaPath || !node.data?.instanceId) {
        console.warn('Invalid node in saved state, clearing');
        clearBuilderState();
        return null;
      }
    }

    // Validate edges have required properties
    for (const edge of state.edges) {
      if (!edge.id || !edge.source || !edge.target) {
        console.warn('Invalid edge in saved state, clearing');
        clearBuilderState();
        return null;
      }
    }

    return state;
  } catch (error) {
    console.error('Failed to load builder state:', error);
    clearBuilderState();
    return null;
  }
}

/**
 * Clear saved builder state from localStorage
 */
export function clearBuilderState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Failed to clear builder state:', error);
  }
}

/**
 * Check if saved builder state exists
 * @returns true if state exists in localStorage
 */
export function hasBuilderState(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Extract counter state from saved nodes to restore instance counters
 * This ensures new instances don't collide with saved ones
 * @param nodes - Serialized nodes from saved state
 * @returns Object mapping base names to their highest counter value
 */
export function extractCounterState(nodes: SerializedNode[]): CounterState {
  const counters: CounterState = {};

  for (const node of nodes) {
    const instanceId = node.data.instanceId;
    // Parse instance ID format: "basename-number" (e.g., "user-1", "address-2")
    const match = instanceId.match(/^(.+)-(\d+)$/);
    if (match) {
      const baseName = match[1];
      const counter = parseInt(match[2], 10);
      if (!counters[baseName] || counter > counters[baseName]) {
        counters[baseName] = counter;
      }
    }
  }

  return counters;
}

/**
 * Restore instance counters from saved nodes
 * This should be called after loading state to ensure new instances
 * get IDs that don't conflict with existing ones
 * @param nodes - Serialized nodes from saved state
 * @param setCounter - Function to set a counter value (from builderTypes)
 */
export function restoreInstanceCounters(
  nodes: SerializedNode[],
  setCounter: (baseName: string, value: number) => void
): void {
  const counters = extractCounterState(nodes);
  for (const [baseName, value] of Object.entries(counters)) {
    setCounter(baseName, value);
  }
}

/**
 * Create a debounced version of a function
 * @param fn - Function to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced function
 */
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delay);
  };
}
