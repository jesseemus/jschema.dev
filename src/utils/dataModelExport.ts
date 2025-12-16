/**
 * Data Model Export & Import
 * 
 * Converts builder state (nodes and edges) to JSON data.
 * Each node becomes a JSON object, connections become nested objects or array items.
 * 
 * Also provides import functionality to convert JSON data back to nodes and edges.
 */

import type { Node, Edge } from 'reactflow';
import { getSchemaConnectionRules } from './schemaRelationships';
import { generateInstanceId } from './builderTypes';

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

// ============================================================================
// IMPORT FUNCTIONALITY
// ============================================================================

/**
 * Result of import validation
 */
export interface ImportValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  matchedSchema?: string;  // The schema path that matches the data
}

/**
 * Result of importing JSON data
 */
export interface ImportResult {
  success: boolean;
  nodes: Node[];
  edges: Edge[];
  errors: string[];
}

/**
 * Find a schema that matches the given data object
 * Checks required properties and type compatibility
 */
function findMatchingSchema(
  data: Record<string, any>,
  schemas: Record<string, object>
): { schemaPath: string; score: number } | null {
  const dataKeys = Object.keys(data).filter(k => !k.startsWith('_')); // Ignore metadata keys
  let bestMatch: { schemaPath: string; score: number } | null = null;

  for (const [schemaPath, schema] of Object.entries(schemas)) {
    const schemaObj = schema as Record<string, any>;
    
    if (!schemaObj.properties || schemaObj.type !== 'object') {
      continue;
    }

    const schemaProps = Object.keys(schemaObj.properties);
    const requiredProps = (schemaObj.required as string[]) || [];
    
    // Check if all required properties are present
    const hasAllRequired = requiredProps.every(prop => prop in data);
    if (!hasAllRequired) {
      continue;
    }
    
    // Score based on matching properties
    const matchingProps = dataKeys.filter(key => schemaProps.includes(key));
    const score = matchingProps.length / Math.max(dataKeys.length, schemaProps.length);
    
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { schemaPath, score };
    }
  }
  
  // Require at least 50% property match
  return bestMatch && bestMatch.score >= 0.5 ? bestMatch : null;
}

/**
 * Validate a value against a schema property definition
 */
function validateValue(value: any, propDef: Record<string, any>): boolean {
  if (value === null || value === undefined) {
    return true; // Allow null/undefined for optional fields
  }

  const type = propDef.type;
  
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
    case 'integer':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && !Array.isArray(value);
    default:
      return true; // Unknown type, allow
  }
}

/**
 * Validate that JSON data conforms to a specific schema
 */
export function validateDataAgainstSchema(
  data: Record<string, any>,
  schemaPath: string,
  schemas: Record<string, object>
): ImportValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  const schema = schemas[schemaPath] as Record<string, any>;
  if (!schema) {
    return { valid: false, errors: [`Schema not found: ${schemaPath}`], warnings };
  }

  if (schema.type !== 'object' || !schema.properties) {
    return { valid: false, errors: ['Schema is not an object type'], warnings };
  }

  const schemaProps = schema.properties as Record<string, any>;
  const requiredProps = (schema.required as string[]) || [];
  
  // Check required properties
  for (const reqProp of requiredProps) {
    if (!(reqProp in data)) {
      errors.push(`Missing required property: ${reqProp}`);
    }
  }
  
  // Validate property types
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('_')) continue; // Skip metadata
    
    const propDef = schemaProps[key];
    if (!propDef) {
      warnings.push(`Unknown property: ${key}`);
      continue;
    }
    
    // Skip $ref properties - they will be handled as connections
    if (propDef.$ref) continue;
    if (propDef.type === 'array' && propDef.items?.$ref) continue;
    
    if (!validateValue(value, propDef)) {
      errors.push(`Property '${key}' has invalid type. Expected ${propDef.type}, got ${typeof value}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    matchedSchema: schemaPath,
  };
}

/**
 * Validate imported JSON data against available schemas
 */
export function validateImportData(
  data: any,
  schemas: Record<string, object>
): ImportValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Invalid JSON: Expected an object'], warnings };
  }
  
  // Handle array of objects
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return { valid: false, errors: ['Empty array - nothing to import'], warnings };
    }
    
    // Validate each item
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        errors.push(`Item ${i}: Not a valid object`);
        continue;
      }
      
      const match = findMatchingSchema(item, schemas);
      if (!match) {
        errors.push(`Item ${i}: No matching schema found`);
      } else if (match.score < 0.8) {
        warnings.push(`Item ${i}: Partial schema match (${Math.round(match.score * 100)}%)`);
      }
    }
    
    return { valid: errors.length === 0, errors, warnings };
  }
  
  // Single object
  const match = findMatchingSchema(data, schemas);
  if (!match) {
    return { valid: false, errors: ['No matching schema found for the data'], warnings };
  }
  
  // Validate against matched schema
  const validation = validateDataAgainstSchema(data, match.schemaPath, schemas);
  
  if (match.score < 0.8) {
    validation.warnings.push(`Partial schema match (${Math.round(match.score * 100)}%)`);
  }
  
  return validation;
}

/**
 * Import JSON data and create nodes and edges
 */
export function importFromJson(
  data: any,
  schemas: Record<string, object>,
  startPosition: { x: number; y: number } = { x: 100, y: 100 }
): ImportResult {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const errors: string[] = [];
  
  // Track created instances by their position in the data
  const instanceMap = new Map<any, string>(); // data object -> instance ID
  let nodeIndex = 0;
  
  const NODE_WIDTH = 320;
  const NODE_HEIGHT = 200;
  const HORIZONTAL_GAP = 100;
  const VERTICAL_GAP = 80;
  
  /**
   * Create a node from data object
   */
  function createNodeFromData(
    dataObj: Record<string, any>,
    position: { x: number; y: number },
    parentId?: string,
    propertyPath?: string
  ): string | null {
    // Check if we already created this instance
    if (instanceMap.has(dataObj)) {
      const existingId = instanceMap.get(dataObj)!;
      // Create edge to existing instance
      if (parentId && propertyPath) {
        const edgeId = `e-${parentId}-${existingId}-${propertyPath}`;
        if (!edges.find(e => e.id === edgeId)) {
          edges.push(createEdge(edgeId, parentId, existingId, propertyPath, false));
        }
      }
      return existingId;
    }
    
    // Find matching schema
    const match = findMatchingSchema(dataObj, schemas);
    if (!match) {
      errors.push(`Could not find matching schema for object: ${JSON.stringify(dataObj).slice(0, 100)}...`);
      return null;
    }
    
    const schemaPath = match.schemaPath;
    const schema = schemas[schemaPath] as Record<string, any>;
    const instanceId = generateInstanceId(schemaPath);
    
    instanceMap.set(dataObj, instanceId);
    
    // Extract schema info
    const schemaTitle = schema.title || schemaPath.split('/').pop()?.replace('.schema.json', '') || 'Unknown';
    
    // Separate values from nested objects
    const values: Record<string, any> = {};
    const connectionRules = getSchemaConnectionRules(schema, schemaPath);
    const refProps = new Set(connectionRules.map(r => r.propertyPath));
    
    for (const [key, value] of Object.entries(dataObj)) {
      if (key.startsWith('_')) continue; // Skip metadata
      if (!refProps.has(key)) {
        values[key] = value;
      }
    }
    
    // Create the node
    const node: Node = {
      id: instanceId,
      type: 'builderNode',
      position: {
        x: position.x,
        y: position.y,
      },
      data: {
        instanceId,
        schemaPath,
        schemaTitle,
        values,
      },
    };
    
    nodes.push(node);
    nodeIndex++;
    
    // Create edge from parent
    if (parentId && propertyPath) {
      const isArray = connectionRules.find(r => r.propertyPath === propertyPath)?.cardinality === 'many';
      const edgeId = `e-${parentId}-${instanceId}-${propertyPath}`;
      edges.push(createEdge(edgeId, parentId, instanceId, propertyPath, isArray));
    }
    
    // Process nested objects (connections)
    let childIndex = 0;
    for (const rule of connectionRules) {
      const nestedValue = dataObj[rule.propertyPath];
      if (nestedValue === null || nestedValue === undefined) continue;
      
      const childX = position.x + NODE_WIDTH + HORIZONTAL_GAP;
      
      if (rule.cardinality === 'one' && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
        // Single nested object
        const childY = position.y + (childIndex * (NODE_HEIGHT + VERTICAL_GAP));
        createNodeFromData(nestedValue, { x: childX, y: childY }, instanceId, rule.propertyPath);
        childIndex++;
      } else if (rule.cardinality === 'many' && Array.isArray(nestedValue)) {
        // Array of nested objects
        for (let i = 0; i < nestedValue.length; i++) {
          const item = nestedValue[i];
          if (typeof item === 'object' && item !== null) {
            const childY = position.y + ((childIndex + i) * (NODE_HEIGHT + VERTICAL_GAP));
            createNodeFromData(item, { x: childX, y: childY }, instanceId, rule.propertyPath);
          }
        }
        childIndex += nestedValue.length;
      }
    }
    
    return instanceId;
  }
  
  /**
   * Create an edge with proper styling
   */
  function createEdge(id: string, source: string, target: string, sourceHandle: string, isArray: boolean): Edge {
    return {
      id,
      source,
      target,
      sourceHandle,
      targetHandle: 'target',
      type: 'default',
      animated: false,
      style: {
        stroke: isArray ? '#ffa726' : '#61dafb',
        strokeWidth: 2,
      },
      markerEnd: {
        type: 'arrowclosed' as any,
        color: isArray ? '#ffa726' : '#61dafb',
      },
      label: sourceHandle,
      labelStyle: {
        fill: '#ccc',
        fontSize: 10,
      },
      labelBgStyle: {
        fill: '#1e1e1e',
        fillOpacity: 0.8,
      },
    };
  }
  
  // Process the data
  if (Array.isArray(data)) {
    // Multiple root objects
    let yOffset = startPosition.y;
    for (const item of data) {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        createNodeFromData(item, { x: startPosition.x, y: yOffset });
        yOffset += NODE_HEIGHT + VERTICAL_GAP;
      }
    }
  } else {
    // Single root object
    createNodeFromData(data, startPosition);
  }
  
  return {
    success: errors.length === 0,
    nodes,
    edges,
    errors,
  };
}
