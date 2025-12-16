/**
 * Data Model Export
 * 
 * Converts builder state (nodes and edges) to JSON data.
 * Each node becomes a JSON object, connections become nested objects or array items.
 */

import type { Node, Edge } from 'reactflow';
import { getSchemaConnectionRules } from './schemaRelationships';

/**
 * Options for exporting the data model
 */
export interface ExportOptions {
  includeMetadata?: boolean;  // Include _schemaPath, _instanceId in output
  rootInstanceId?: string;    // If specified, export from this root only
}

/**
 * Get the default value for a schema property type
 */
function getDefaultValue(propertyDef: any): any {
  if (!propertyDef) return null;
  
  // Check for explicit default
  if (propertyDef.default !== undefined) {
    return propertyDef.default;
  }
  
  // Return null for most types (user will fill in)
  // Arrays for array types, objects for object types
  switch (propertyDef.type) {
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return null;
  }
}

/**
 * Find all root instances (nodes with no incoming edges)
 * @param nodes - All nodes in the builder
 * @param edges - All edges in the builder
 * @returns Array of node IDs that are root instances
 */
export function findRootInstances(nodes: Node[], edges: Edge[]): string[] {
  // Get all node IDs that are targets of edges
  const targetIds = new Set(edges.map(edge => edge.target));
  
  // Root instances are those that have no incoming edges
  return nodes
    .filter(node => !targetIds.has(node.id))
    .map(node => node.id);
}

/**
 * Get all outgoing edges for an instance
 * @param nodeId - The node ID to get connections for
 * @param edges - All edges in the builder
 * @returns Array of edges where this node is the source
 */
export function getInstanceConnections(nodeId: string, edges: Edge[]): Edge[] {
  return edges.filter(edge => edge.source === nodeId);
}

/**
 * Build a JSON object from an instance, recursively including connected instances
 * @param nodeId - The node ID to build from
 * @param nodes - All nodes in the builder
 * @param edges - All edges in the builder
 * @param schemas - Record of schema path to schema object
 * @param visited - Set of already visited node IDs (to prevent cycles)
 * @param options - Export options
 * @returns The built JSON object
 */
export function buildObjectFromInstance(
  nodeId: string,
  nodes: Node[],
  edges: Edge[],
  schemas: Record<string, object>,
  visited: Set<string>,
  options?: ExportOptions
): object | null {
  // Prevent infinite loops from circular references
  if (visited.has(nodeId)) {
    return null;
  }
  visited.add(nodeId);
  
  // Find the node
  const node = nodes.find(n => n.id === nodeId);
  if (!node) {
    return null;
  }
  
  // Get the schema path from node data
  const schemaPath = node.data?.schemaPath as string | undefined;
  if (!schemaPath) {
    return null;
  }
  
  // Get the schema
  const schema = schemas[schemaPath] as Record<string, any> | undefined;
  if (!schema) {
    return null;
  }
  
  // Get user-entered values from node data
  const nodeValues = (node.data?.values as Record<string, any>) || {};
  
  // Build the result object
  const result: Record<string, any> = {};
  
  // Add metadata if requested
  if (options?.includeMetadata) {
    result._schemaPath = schemaPath;
    result._instanceId = nodeId;
  }
  
  // Get connection rules to know which properties are $ref properties
  const connectionRules = getSchemaConnectionRules(schema, schemaPath);
  const refPropertyPaths = new Set(connectionRules.map(rule => rule.propertyPath));
  
  // Get all outgoing connections from this instance
  const outgoingConnections = getInstanceConnections(nodeId, edges);
  
  // Group connections by property path
  const connectionsByProperty = new Map<string, Edge[]>();
  outgoingConnections.forEach(edge => {
    const propertyPath = edge.sourceHandle || '';
    if (!connectionsByProperty.has(propertyPath)) {
      connectionsByProperty.set(propertyPath, []);
    }
    connectionsByProperty.get(propertyPath)!.push(edge);
  });
  
  // Process schema properties
  if (schema.properties && typeof schema.properties === 'object') {
    for (const [propName, propDef] of Object.entries(schema.properties)) {
      // Check if this property is a $ref property
      if (refPropertyPaths.has(propName)) {
        // Find the connection rule for this property
        const rule = connectionRules.find(r => r.propertyPath === propName);
        
        if (rule) {
          const connections = connectionsByProperty.get(propName) || [];
          
          if (rule.cardinality === 'one') {
            // Single $ref - set as nested object or null
            if (connections.length > 0) {
              const connectedObject = buildObjectFromInstance(
                connections[0].target,
                nodes,
                edges,
                schemas,
                visited,
                options
              );
              result[propName] = connectedObject;
            } else {
              result[propName] = null;
            }
          } else {
            // Array with $ref items - build array of connected objects
            const items: any[] = [];
            for (const connection of connections) {
              const connectedObject = buildObjectFromInstance(
                connection.target,
                nodes,
                edges,
                schemas,
                new Set(visited), // Use new set to allow same object in multiple arrays
                options
              );
              if (connectedObject !== null) {
                items.push(connectedObject);
              }
            }
            result[propName] = items;
          }
        }
      } else {
        // Non-ref property - use user-entered value or default
        const userValue = nodeValues[propName];
        result[propName] = userValue !== undefined ? userValue : getDefaultValue(propDef as any);
      }
    }
  }
  
  return result;
}

/**
 * Export the data model to JSON
 * @param nodes - All nodes in the builder
 * @param edges - All edges in the builder
 * @param schemas - Record of schema path to schema object
 * @param options - Export options
 * @returns The exported JSON data (object or array of objects)
 */
export function exportToJson(
  nodes: Node[],
  edges: Edge[],
  schemas: Record<string, object>,
  options?: ExportOptions
): object | object[] {
  // If no nodes, return empty array
  if (nodes.length === 0) {
    return [];
  }
  
  // If a specific root is requested, export just that instance
  if (options?.rootInstanceId) {
    const visited = new Set<string>();
    const result = buildObjectFromInstance(
      options.rootInstanceId,
      nodes,
      edges,
      schemas,
      visited,
      options
    );
    return result || {};
  }
  
  // Find all root instances (nodes with no incoming edges)
  const rootIds = findRootInstances(nodes, edges);
  
  // If no roots found (all nodes have incoming connections - circular case)
  // fall back to exporting all nodes as roots
  const idsToExport = rootIds.length > 0 ? rootIds : nodes.map(n => n.id);
  
  // Build objects from each root
  const results: object[] = [];
  for (const rootId of idsToExport) {
    const visited = new Set<string>();
    const result = buildObjectFromInstance(
      rootId,
      nodes,
      edges,
      schemas,
      visited,
      options
    );
    if (result !== null) {
      results.push(result);
    }
  }
  
  // Return single object if only one root, otherwise return array
  if (results.length === 1) {
    return results[0];
  }
  
  return results;
}

/**
 * Trigger a file download with the given content
 * @param content - The content to download
 * @param filename - The filename to use
 * @param mimeType - The MIME type of the content
 */
export function downloadFile(content: string, filename: string, mimeType: string = 'application/json'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
}
