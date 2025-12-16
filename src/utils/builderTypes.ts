/**
 * Type definitions for the Data Model Builder
 */

/**
 * Represents a data instance on the canvas
 */
export interface DataInstance {
  id: string;
  schemaPath: string;
  position: { x: number; y: number };
  data: object;
}

/**
 * Represents a connection between two data instances
 */
export interface DataConnection {
  id: string;
  sourceId: string;
  targetId: string;
  propertyPath: string;
}

/**
 * Schema metadata extracted from schema JSON
 */
export interface SchemaInfo {
  path: string;
  title: string;
  description?: string;
  $id?: string;
}

// Counter for generating unique instance IDs per schema type
const instanceCounters: Map<string, number> = new Map();

/**
 * Generate a unique instance ID for a schema
 * @param schemaPath - The path of the schema (e.g., "v1/user/user.schema.json")
 * @returns A unique ID (e.g., "user-1", "user-2")
 */
export function generateInstanceId(schemaPath: string): string {
  // Extract the schema name from the path
  const fileName = schemaPath.split('/').pop() || schemaPath;
  const baseName = fileName.replace('.schema.json', '').replace('.json', '');
  
  // Get or initialize the counter for this schema type
  const currentCount = instanceCounters.get(baseName) || 0;
  const newCount = currentCount + 1;
  instanceCounters.set(baseName, newCount);
  
  return `${baseName}-${newCount}`;
}

/**
 * Reset all instance counters (useful for clearing the canvas)
 */
export function resetInstanceCounters(): void {
  instanceCounters.clear();
}

/**
 * Set the counter for a specific schema base name
 * Used when restoring state from localStorage
 * @param baseName - The base name of the schema (e.g., "user", "address")
 * @param value - The counter value to set
 */
export function setInstanceCounter(baseName: string, value: number): void {
  instanceCounters.set(baseName, value);
}

/**
 * Extract schema info from a schema object
 * @param schemaPath - The path of the schema
 * @param schema - The schema object
 * @returns SchemaInfo with extracted metadata
 */
export function extractSchemaInfo(schemaPath: string, schema: object): SchemaInfo {
  const schemaObj = schema as Record<string, unknown>;
  return {
    path: schemaPath,
    title: (schemaObj.title as string) || getSchemaNameFromPath(schemaPath),
    description: schemaObj.description as string | undefined,
    $id: schemaObj.$id as string | undefined,
  };
}

/**
 * Get a display name from a schema path
 * @param schemaPath - The path of the schema
 * @returns A human-readable name
 */
export function getSchemaNameFromPath(schemaPath: string): string {
  const fileName = schemaPath.split('/').pop() || schemaPath;
  const baseName = fileName.replace('.schema.json', '').replace('.json', '');
  // Convert kebab-case or snake_case to Title Case
  return baseName
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Group schemas by their folder/entity
 * @param schemas - Record of schema path to schema object
 * @returns Map of folder name to array of SchemaInfo
 */
export function groupSchemasByFolder(schemas: Record<string, object>): Map<string, SchemaInfo[]> {
  const groups = new Map<string, SchemaInfo[]>();
  
  Object.entries(schemas).forEach(([path, schema]) => {
    const parts = path.split('/');
    // Get the folder name (e.g., "user" from "v1/user/user.schema.json")
    const folderName = parts.length > 1 ? parts[parts.length - 2] : 'root';
    const displayFolder = folderName.charAt(0).toUpperCase() + folderName.slice(1);
    
    const schemaInfo = extractSchemaInfo(path, schema);
    
    if (!groups.has(displayFolder)) {
      groups.set(displayFolder, []);
    }
    groups.get(displayFolder)!.push(schemaInfo);
  });
  
  // Sort schemas within each group
  groups.forEach((schemas) => {
    schemas.sort((a, b) => a.title.localeCompare(b.title));
  });
  
  return groups;
}
