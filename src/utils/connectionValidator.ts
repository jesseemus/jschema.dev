/**
 * Connection Validator
 * 
 * Validates connections between data instances based on schema $ref definitions.
 * Enforces cardinality rules:
 * - Single $ref = max 1 connection to that property
 * - Array with $ref items = unlimited connections
 */

import { getSchemaConnectionRules, type ConnectionRule } from './schemaRelationships';
import type { DataConnection, DataInstance } from './builderTypes';

/**
 * Result of checking if a connection between schemas is valid
 */
export interface ConnectionValidation {
    valid: boolean;
    propertyPath?: string;
    cardinality?: 'one' | 'many';
    reason?: string;
}

/**
 * Result of validating a specific connection attempt
 */
export interface ValidationResult {
    valid: boolean;
    reason?: string;
}

/**
 * Get connection rules for a schema
 * @param schema - The schema object
 * @param schemaPath - The path of the schema
 * @param schemas - Optional record of all schemas (needed for resolving array schemas)
 * @returns Array of ConnectionRule objects
 */
export function getConnectionRulesForSchema(schema: object, schemaPath: string, schemas?: Record<string, object>): ConnectionRule[] {
    return getSchemaConnectionRules(schema, schemaPath, schemas);
}

/**
 * Resolve the actual target schema path, following array schemas to their items
 * @param schemaPath - The schema path to resolve
 * @param schemas - Record of all schemas
 * @returns The resolved schema path (e.g., array schema -> items schema)
 */
function resolveTargetSchemaPath(schemaPath: string, schemas: Record<string, object>): string[] {
    let schema = schemas[schemaPath] as Record<string, any>;
    
    // Try to find schema with flexible matching if not found directly
    let actualPath = schemaPath;
    if (!schema) {
        const matchingKey = Object.keys(schemas).find(key => 
            key.endsWith(schemaPath) || schemaPath.endsWith(key)
        );
        if (matchingKey) {
            schema = schemas[matchingKey] as Record<string, any>;
            actualPath = matchingKey;
        }
    }
    
    if (!schema) {
        return [schemaPath];
    }
    
    const results: string[] = [actualPath];
    
    // Check if this is an array schema with items.$ref
    if (schema.items?.$ref) {
        const itemsRef = resolveRefPath(schema.items.$ref, actualPath);
        results.push(itemsRef);
        // Recursively resolve in case of nested arrays
        results.push(...resolveTargetSchemaPath(itemsRef, schemas));
    }
    
    // Check allOf for array schemas
    if (Array.isArray(schema.allOf)) {
        for (const sub of schema.allOf) {
            if (sub.items?.$ref) {
                const itemsRef = resolveRefPath(sub.items.$ref, actualPath);
                results.push(itemsRef);
                results.push(...resolveTargetSchemaPath(itemsRef, schemas));
            }
        }
    }
    
    // Check anyOf - schema can be any of these types
    if (Array.isArray(schema.anyOf)) {
        for (const sub of schema.anyOf) {
            if (sub.$ref) {
                const anyOfRef = resolveRefPath(sub.$ref, actualPath);
                results.push(anyOfRef);
                results.push(...resolveTargetSchemaPath(anyOfRef, schemas));
            }
        }
    }
    
    // Check oneOf - schema can be one of these types
    if (Array.isArray(schema.oneOf)) {
        for (const sub of schema.oneOf) {
            if (sub.$ref) {
                const oneOfRef = resolveRefPath(sub.$ref, actualPath);
                results.push(oneOfRef);
                results.push(...resolveTargetSchemaPath(oneOfRef, schemas));
            }
        }
    }
    
    return [...new Set(results)]; // Remove duplicates
}

/**
 * Resolve a relative $ref path to an absolute path
 */
function resolveRefPath(ref: string, basePath: string): string {
    let refPath = ref.split('#')[0];
    
    if (refPath.startsWith('../') || refPath.startsWith('./')) {
        const baseDir = basePath.substring(0, basePath.lastIndexOf('/'));
        const baseParts = baseDir.split('/').filter(p => p);
        const relParts = refPath.split('/').filter(p => p);
        const resultParts = [...baseParts];
        for (const part of relParts) {
            if (part === '..') resultParts.pop();
            else if (part !== '.') resultParts.push(part);
        }
        return resultParts.join('/');
    } else if (!refPath.includes('/')) {
        const baseDir = basePath.substring(0, basePath.lastIndexOf('/'));
        return baseDir ? `${baseDir}/${refPath}` : refPath;
    }
    
    return refPath;
}

/**
 * Check if a connection from source schema to target schema is allowed
 * @param sourceSchemaPath - Path of the source schema
 * @param targetSchemaPath - Path of the target schema
 * @param schemas - Record of all schemas (path -> schema object)
 * @returns ConnectionValidation result
 */
export function canConnect(
    sourceSchemaPath: string,
    targetSchemaPath: string,
    schemas: Record<string, object>
): ConnectionValidation {
    const sourceSchema = schemas[sourceSchemaPath];
    
    if (!sourceSchema) {
        return {
            valid: false,
            reason: `Source schema not found: ${sourceSchemaPath}`
        };
    }

    const rules = getConnectionRulesForSchema(sourceSchema, sourceSchemaPath, schemas);
    
    // Find a rule that allows connection to the target schema
    // Check both direct matches and indirect matches through array schemas
    const matchingRule = rules.find(rule => {
        // Direct match
        if (rule.targetSchemaPath === targetSchemaPath) {
            return true;
        }
        
        // Check if the rule's target is an array schema that contains items of the target type
        const resolvedTargets = resolveTargetSchemaPath(rule.targetSchemaPath, schemas);
        return resolvedTargets.includes(targetSchemaPath);
    });
    
    if (!matchingRule) {
        return {
            valid: false,
            reason: `No $ref from ${sourceSchemaPath} to ${targetSchemaPath}`
        };
    }

    return {
        valid: true,
        propertyPath: matchingRule.propertyPath,
        cardinality: matchingRule.cardinality
    };
}

/**
 * Validate a connection attempt between two instances
 * @param sourceInstanceId - ID of the source instance
 * @param targetInstanceId - ID of the target instance
 * @param propertyPath - The property path being connected
 * @param existingConnections - Array of existing connections
 * @param schemas - Record of all schemas
 * @param instances - Map of instance ID to DataInstance
 * @returns ValidationResult
 */
export function validateConnection(
    sourceInstanceId: string,
    targetInstanceId: string,
    propertyPath: string,
    existingConnections: DataConnection[],
    schemas: Record<string, object>,
    instances: Map<string, DataInstance>
): ValidationResult {
    // Get source and target instances
    const sourceInstance = instances.get(sourceInstanceId);
    const targetInstance = instances.get(targetInstanceId);

    if (!sourceInstance) {
        return {
            valid: false,
            reason: `Source instance not found: ${sourceInstanceId}`
        };
    }

    if (!targetInstance) {
        return {
            valid: false,
            reason: `Target instance not found: ${targetInstanceId}`
        };
    }

    // Get the source schema and its connection rules
    const sourceSchema = schemas[sourceInstance.schemaPath];
    if (!sourceSchema) {
        return {
            valid: false,
            reason: `Source schema not found: ${sourceInstance.schemaPath}`
        };
    }

    const rules = getConnectionRulesForSchema(sourceSchema, sourceInstance.schemaPath, schemas);
    
    // Find the rule for the specified property
    const rule = rules.find(r => r.propertyPath === propertyPath);
    
    if (!rule) {
        return {
            valid: false,
            reason: `Property '${propertyPath}' does not have a $ref in schema ${sourceInstance.schemaPath}`
        };
    }

    // Check if the target schema matches the rule's target (including through array schemas)
    const resolvedTargets = resolveTargetSchemaPath(rule.targetSchemaPath, schemas);
    if (!resolvedTargets.includes(targetInstance.schemaPath)) {
        return {
            valid: false,
            reason: `Property '${propertyPath}' expects ${rule.targetSchemaPath}, got ${targetInstance.schemaPath}`
        };
    }

    // Check cardinality constraints
    if (rule.cardinality === 'one') {
        // For one-to-one, check if there's already a connection on this property from this source
        const existingConnection = existingConnections.find(
            conn => conn.sourceId === sourceInstanceId && conn.propertyPath === propertyPath
        );

        if (existingConnection) {
            return {
                valid: false,
                reason: `Property '${propertyPath}' already has a connection (one-to-one). Remove existing connection first.`
            };
        }
    }
    // For 'many' cardinality, always allow additional connections

    // Prevent connecting to self
    if (sourceInstanceId === targetInstanceId) {
        return {
            valid: false,
            reason: 'Cannot connect an instance to itself'
        };
    }

    // Check for duplicate connections (same source, target, and property)
    const duplicateConnection = existingConnections.find(
        conn => conn.sourceId === sourceInstanceId && 
                conn.targetId === targetInstanceId && 
                conn.propertyPath === propertyPath
    );

    if (duplicateConnection) {
        return {
            valid: false,
            reason: 'This exact connection already exists'
        };
    }

    return { valid: true };
}

/**
 * Get all instance IDs that can be connected to a source instance's property
 * @param sourceInstanceId - ID of the source instance
 * @param propertyPath - The property path to connect
 * @param instances - Map of all instances
 * @param schemas - Record of all schemas
 * @param existingConnections - Array of existing connections (optional, for cardinality checking)
 * @returns Array of valid target instance IDs
 */
export function getValidTargets(
    sourceInstanceId: string,
    propertyPath: string,
    instances: Map<string, DataInstance>,
    schemas: Record<string, object>,
    existingConnections: DataConnection[] = []
): string[] {
    const sourceInstance = instances.get(sourceInstanceId);
    if (!sourceInstance) {
        return [];
    }

    const sourceSchema = schemas[sourceInstance.schemaPath];
    if (!sourceSchema) {
        return [];
    }

    const rules = getConnectionRulesForSchema(sourceSchema, sourceInstance.schemaPath, schemas);
    const rule = rules.find(r => r.propertyPath === propertyPath);
    
    if (!rule) {
        return [];
    }

    // Resolve the target schema path (follow array schemas to their items)
    const resolvedTargets = resolveTargetSchemaPath(rule.targetSchemaPath, schemas);

    // For one-to-one cardinality, check if already connected
    if (rule.cardinality === 'one') {
        const existingConnection = existingConnections.find(
            conn => conn.sourceId === sourceInstanceId && conn.propertyPath === propertyPath
        );
        if (existingConnection) {
            // Already has a connection, no valid targets
            return [];
        }
    }

    // Find all instances that match the target schema type
    const validTargets: string[] = [];
    
    instances.forEach((instance, instanceId) => {
        // Skip self
        if (instanceId === sourceInstanceId) {
            return;
        }

        // Check if instance's schema matches the rule's target (including through array schemas)
        if (resolvedTargets.includes(instance.schemaPath)) {
            // For 'many' cardinality, check if this exact connection already exists
            if (rule.cardinality === 'many') {
                const alreadyConnected = existingConnections.some(
                    conn => conn.sourceId === sourceInstanceId && 
                            conn.targetId === instanceId && 
                            conn.propertyPath === propertyPath
                );
                if (!alreadyConnected) {
                    validTargets.push(instanceId);
                }
            } else {
                validTargets.push(instanceId);
            }
        }
    });

    return validTargets;
}

/**
 * Get all properties of a source instance that can connect to a target instance
 * @param sourceInstanceId - ID of the source instance
 * @param targetInstanceId - ID of the target instance
 * @param instances - Map of all instances
 * @param schemas - Record of all schemas
 * @param existingConnections - Array of existing connections
 * @returns Array of property paths that can connect to the target
 */
export function getConnectableProperties(
    sourceInstanceId: string,
    targetInstanceId: string,
    instances: Map<string, DataInstance>,
    schemas: Record<string, object>,
    existingConnections: DataConnection[] = []
): string[] {
    const sourceInstance = instances.get(sourceInstanceId);
    const targetInstance = instances.get(targetInstanceId);
    
    if (!sourceInstance || !targetInstance) {
        return [];
    }

    // Can't connect to self
    if (sourceInstanceId === targetInstanceId) {
        return [];
    }

    const sourceSchema = schemas[sourceInstance.schemaPath];
    if (!sourceSchema) {
        return [];
    }

    const rules = getConnectionRulesForSchema(sourceSchema, sourceInstance.schemaPath, schemas);
    const connectableProperties: string[] = [];

    for (const rule of rules) {
        // Check if this rule targets the target instance's schema
        if (rule.targetSchemaPath !== targetInstance.schemaPath) {
            continue;
        }

        // Check cardinality constraints
        if (rule.cardinality === 'one') {
            const existingConnection = existingConnections.find(
                conn => conn.sourceId === sourceInstanceId && conn.propertyPath === rule.propertyPath
            );
            if (existingConnection) {
                // Already connected, skip this property
                continue;
            }
        } else {
            // For 'many', check if this exact connection already exists
            const duplicateConnection = existingConnections.find(
                conn => conn.sourceId === sourceInstanceId && 
                        conn.targetId === targetInstanceId && 
                        conn.propertyPath === rule.propertyPath
            );
            if (duplicateConnection) {
                continue;
            }
        }

        connectableProperties.push(rule.propertyPath);
    }

    return connectableProperties;
}

/**
 * Get all instance IDs that can connect TO a target instance (reverse lookup)
 * Used when dragging from a target handle to find valid source nodes
 * @param targetInstanceId - ID of the target instance being dragged from
 * @param instances - Map of all instances
 * @param schemas - Record of all schemas
 * @param existingConnections - Array of existing connections
 * @returns Array of valid source instance IDs that have properties pointing to this target's schema
 */
export function getValidSources(
    targetInstanceId: string,
    instances: Map<string, DataInstance>,
    schemas: Record<string, object>,
    existingConnections: DataConnection[] = []
): string[] {
    const targetInstance = instances.get(targetInstanceId);
    if (!targetInstance) {
        return [];
    }

    const targetSchemaPath = targetInstance.schemaPath;
    const validSources: string[] = [];

    // Look through all instances to find ones that can connect to this target
    instances.forEach((sourceInstance, sourceInstanceId) => {
        // Skip self
        if (sourceInstanceId === targetInstanceId) {
            return;
        }

        const sourceSchema = schemas[sourceInstance.schemaPath];
        if (!sourceSchema) {
            return;
        }

        // Get connection rules for this source schema
        const rules = getConnectionRulesForSchema(sourceSchema, sourceInstance.schemaPath, schemas);

        // Check if any rule points to our target's schema type
        for (const rule of rules) {
            // Resolve the target schema path (follow array schemas to their items)
            const resolvedTargets = resolveTargetSchemaPath(rule.targetSchemaPath, schemas);
            
            if (resolvedTargets.includes(targetSchemaPath)) {
                // Check if connection already exists based on cardinality
                if (rule.cardinality === 'one') {
                    const existingConnection = existingConnections.find(
                        conn => conn.sourceId === sourceInstanceId && conn.propertyPath === rule.propertyPath
                    );
                    if (existingConnection) {
                        continue; // Already has a connection on this property
                    }
                } else {
                    // For 'many', check if this exact connection already exists
                    const duplicateConnection = existingConnections.find(
                        conn => conn.sourceId === sourceInstanceId && 
                                conn.targetId === targetInstanceId && 
                                conn.propertyPath === rule.propertyPath
                    );
                    if (duplicateConnection) {
                        continue;
                    }
                }

                // This source can connect to our target
                if (!validSources.includes(sourceInstanceId)) {
                    validSources.push(sourceInstanceId);
                }
            }
        }
    });

    return validSources;
}