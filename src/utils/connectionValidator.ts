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
 * @returns Array of ConnectionRule objects
 */
export function getConnectionRulesForSchema(schema: object, schemaPath: string): ConnectionRule[] {
    return getSchemaConnectionRules(schema, schemaPath);
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

    const rules = getConnectionRulesForSchema(sourceSchema, sourceSchemaPath);
    
    // Find a rule that allows connection to the target schema
    const matchingRule = rules.find(rule => rule.targetSchemaPath === targetSchemaPath);
    
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

    const rules = getConnectionRulesForSchema(sourceSchema, sourceInstance.schemaPath);
    
    // Find the rule for the specified property
    const rule = rules.find(r => r.propertyPath === propertyPath);
    
    if (!rule) {
        return {
            valid: false,
            reason: `Property '${propertyPath}' does not have a $ref in schema ${sourceInstance.schemaPath}`
        };
    }

    // Check if the target schema matches the rule's target
    if (rule.targetSchemaPath !== targetInstance.schemaPath) {
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

    const rules = getConnectionRulesForSchema(sourceSchema, sourceInstance.schemaPath);
    const rule = rules.find(r => r.propertyPath === propertyPath);
    
    if (!rule) {
        return [];
    }

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

        // Check if instance's schema matches the rule's target
        if (instance.schemaPath === rule.targetSchemaPath) {
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

    const rules = getConnectionRulesForSchema(sourceSchema, sourceInstance.schemaPath);
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
        const rules = getConnectionRulesForSchema(sourceSchema, sourceInstance.schemaPath);

        // Check if any rule points to our target's schema type
        for (const rule of rules) {
            if (rule.targetSchemaPath === targetSchemaPath) {
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