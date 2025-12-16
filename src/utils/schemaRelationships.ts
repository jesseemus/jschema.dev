import type { Node, Edge } from 'reactflow';

export interface SchemaRelationship {
    from: string;
    to: string;
    refPath: string;
    type: 'one-to-one' | 'one-to-many' | 'multiple';
    propertyName?: string;
}

/**
 * Represents a connection rule extracted from a schema's $ref properties
 */
export interface ConnectionRule {
    propertyPath: string;      // e.g., "profile" or "roles"
    targetSchemaPath: string;  // resolved path to target schema
    cardinality: 'one' | 'many';  // single ref = 'one', array ref = 'many'
    required: boolean;         // if the property is in schema.required
}

/**
 * Extract properties from a schema, including those inside allOf compositions
 */
export const getSchemaProperties = (schema: any): Record<string, any> => {
    let properties: Record<string, any> = {};
    
    if (!schema || typeof schema !== 'object') return properties;
    
    // Direct properties
    if (schema.properties && typeof schema.properties === 'object') {
        properties = { ...properties, ...schema.properties };
    }
    
    // Properties inside allOf
    if (Array.isArray(schema.allOf)) {
        for (const subSchema of schema.allOf) {
            if (subSchema.properties && typeof subSchema.properties === 'object') {
                properties = { ...properties, ...subSchema.properties };
            }
        }
    }
    
    return properties;
};

/**
 * Get the type of a schema, checking allOf for inherited types
 */
export const getSchemaType = (schema: any): string | undefined => {
    if (!schema || typeof schema !== 'object') return undefined;
    
    // Direct type
    if (schema.type) return schema.type;
    
    // Check allOf for type
    if (Array.isArray(schema.allOf)) {
        for (const subSchema of schema.allOf) {
            if (subSchema.type) return subSchema.type;
            // Also check $ref to primitives like object.schema.json, array.schema.json
            if (subSchema.$ref) {
                if (subSchema.$ref.includes('object')) return 'object';
                if (subSchema.$ref.includes('array')) return 'array';
                if (subSchema.$ref.includes('string')) return 'string';
                if (subSchema.$ref.includes('number') || subSchema.$ref.includes('integer')) return 'number';
                if (subSchema.$ref.includes('boolean')) return 'boolean';
            }
        }
    }
    
    return undefined;
};

/**
 * Check if a schema path refers to a primitive type schema
 * These should not be treated as connection targets
 */
const isPrimitiveSchemaPath = (schemaPath: string): boolean => {
    const lowerPath = schemaPath.toLowerCase();
    // Check for primitive type indicators in the path
    const primitivePatterns = [
        '/primitives/',
        '/string.schema.json',
        '/integer.schema.json',
        '/number.schema.json',
        '/boolean.schema.json',
        '/binary-flag.schema.json',
        '/numeric-string.schema.json',
        '/non-empty-string.schema.json',
        '/positive-integer.schema.json',
        '/short-code-string.schema.json',
        '/datatype.schema.json',
        '/datatype-enum.schema.json',
    ];
    
    for (const pattern of primitivePatterns) {
        if (lowerPath.includes(pattern.toLowerCase())) {
            return true;
        }
    }
    
    // Also check if the schema name itself suggests a primitive
    // (e.g., accessoryId.schema.json, variableName.schema.json are likely just strings)
    const fileName = schemaPath.split('/').pop()?.toLowerCase() || '';
    const singleFieldPatterns = [
        'id.schema.json',
        'name.schema.json',
        'description.schema.json',
        'key.schema.json',
        'value.schema.json',
    ];
    
    for (const pattern of singleFieldPatterns) {
        if (fileName.endsWith(pattern)) {
            return true;
        }
    }
    
    return false;
};

/**
 * Check if a resolved schema is a primitive type by examining its content
 */
export const isPrimitiveSchema = (schema: any): boolean => {
    if (!schema || typeof schema !== 'object') return false;
    
    // Direct primitive type
    const primitiveTypes = ['string', 'number', 'integer', 'boolean', 'null'];
    if (primitiveTypes.includes(schema.type)) {
        return true;
    }
    
    // Check if it's just a $ref to a primitive
    if (schema.$ref && typeof schema.$ref === 'string') {
        return isPrimitiveSchemaPath(schema.$ref);
    }
    
    // Check allOf - if it only references primitives
    if (Array.isArray(schema.allOf)) {
        // If any allOf entry has items with $ref, this is an array collection schema, not primitive
        const hasItemsRef = schema.allOf.some((s: any) => s.items?.$ref);
        if (hasItemsRef) {
            return false;
        }
        
        const hasObjectProperties = schema.allOf.some((s: any) => s.properties);
        if (!hasObjectProperties) {
            // Check if all refs are to primitives
            const allPrimitive = schema.allOf.every((s: any) => {
                if (s.$ref) return isPrimitiveSchemaPath(s.$ref);
                if (s.type) return primitiveTypes.includes(s.type);
                return true;
            });
            if (allPrimitive) return true;
        }
    }
    
    return false;
};

/**
 * Check if a schema is an array schema with items.$ref (collection of complex types)
 * This includes schemas using allOf with array primitives + items definition
 */
const isArraySchemaWithItems = (schema: any): boolean => {
    if (!schema || typeof schema !== 'object') return false;
    
    // Direct array with items.$ref
    if (schema.type === 'array' && schema.items?.$ref) {
        return true;
    }
    
    // Direct items.$ref
    if (schema.items?.$ref) {
        return true;
    }
    
    // Check allOf for items.$ref (pattern: allOf with array primitive + items definition)
    if (Array.isArray(schema.allOf)) {
        for (const sub of schema.allOf) {
            if (sub.items?.$ref) {
                return true;
            }
        }
    }
    
    return false;
};

const resolveRelativePath = (basePath: string, relativePath: string): string => {
    const baseDir = basePath.substring(0, basePath.lastIndexOf('/'));

    const baseParts = baseDir.split('/').filter(p => p);
    const relParts = relativePath.split('/').filter(p => p);

    const resultParts = [...baseParts];
    for (const part of relParts) {
        if (part === '..') {
            resultParts.pop();
        } else if (part !== '.') {
            resultParts.push(part);
        }
    }

    return resultParts.join('/');
};

/**
 * Extract connection rules from a schema's $ref properties
 * Only includes refs to complex object schemas, not primitive types
 * @param schema - The schema object to analyze
 * @param schemaPath - The path of the schema (used to resolve relative $refs)
 * @param schemas - Optional map of all loaded schemas (used to check if ref target is primitive)
 * @returns Array of ConnectionRule objects describing allowed connections
 */
export const getSchemaConnectionRules = (schema: any, schemaPath: string, schemas?: Record<string, any>): ConnectionRule[] => {
    const rules: ConnectionRule[] = [];
    const requiredFields = new Set<string>(schema.required || []);

    const processProperty = (propName: string, propValue: any): void => {
        if (!propValue || typeof propValue !== 'object') return;

        // Direct $ref (could be one-to-one or one-to-many if ref is to an array schema)
        if (propValue.$ref && typeof propValue.$ref === 'string') {
            const match = propValue.$ref.match(/^([^#]+)/);
            if (match && match[1] && match[1].endsWith('.json')) {
                let refPath = match[1];
                if (refPath.startsWith('../') || refPath.startsWith('./')) {
                    refPath = resolveRelativePath(schemaPath, refPath);
                } else if (!refPath.includes('/')) {
                    const baseDir = schemaPath.substring(0, schemaPath.lastIndexOf('/'));
                    refPath = baseDir ? `${baseDir}/${refPath}` : refPath;
                }

                // Skip if this is a reference to a primitive schema
                if (isPrimitiveSchemaPath(refPath)) {
                    return;
                }
                
                // Check the actual schema content if available
                // Try to find the schema - it might be keyed with or without base path
                let refSchema = schemas?.[refPath];
                if (!refSchema && schemas) {
                    // Try finding by matching the end of the path
                    const matchingKey = Object.keys(schemas).find(key => 
                        key.endsWith(refPath) || refPath.endsWith(key)
                    );
                    if (matchingKey) {
                        refSchema = schemas[matchingKey];
                        refPath = matchingKey; // Use the actual key
                    }
                }
                
                if (refSchema) {
                    if (isPrimitiveSchema(refSchema)) {
                        return;
                    }
                    
                    // Check if the referenced schema is an array schema (has items.$ref in allOf or directly)
                    if (isArraySchemaWithItems(refSchema)) {
                        rules.push({
                            propertyPath: propName,
                            targetSchemaPath: refPath,
                            cardinality: 'many',
                            required: requiredFields.has(propName)
                        });
                        return;
                    }
                }

                rules.push({
                    propertyPath: propName,
                    targetSchemaPath: refPath,
                    cardinality: 'one',
                    required: requiredFields.has(propName)
                });
            }
            return;
        }

        // Array with $ref items (one-to-many)
        if (propValue.type === 'array' && propValue.items) {
            if (propValue.items.$ref && typeof propValue.items.$ref === 'string') {
                const match = propValue.items.$ref.match(/^([^#]+)/);
                if (match && match[1] && match[1].endsWith('.json')) {
                    let refPath = match[1];
                    if (refPath.startsWith('../') || refPath.startsWith('./')) {
                        refPath = resolveRelativePath(schemaPath, refPath);
                    } else if (!refPath.includes('/')) {
                        const baseDir = schemaPath.substring(0, schemaPath.lastIndexOf('/'));
                        refPath = baseDir ? `${baseDir}/${refPath}` : refPath;
                    }

                    // Skip if this is a reference to a primitive schema
                    if (isPrimitiveSchemaPath(refPath)) {
                        return;
                    }
                    
                    // Also check the actual schema content if available
                    if (schemas && schemas[refPath]) {
                        if (isPrimitiveSchema(schemas[refPath])) {
                            return;
                        }
                    }

                    rules.push({
                        propertyPath: propName,
                        targetSchemaPath: refPath,
                        cardinality: 'many',
                        required: requiredFields.has(propName)
                    });
                }
            }
        }

        // Object with patternProperties containing $ref (one-to-many, keyed by UUID or other pattern)
        if (propValue.type === 'object' && propValue.patternProperties) {
            // Get the first pattern property that has a $ref
            for (const pattern of Object.keys(propValue.patternProperties)) {
                const patternDef = propValue.patternProperties[pattern];
                if (patternDef.$ref && typeof patternDef.$ref === 'string') {
                    const match = patternDef.$ref.match(/^([^#]+)/);
                    if (match && match[1] && match[1].endsWith('.json')) {
                        let refPath = match[1];
                        if (refPath.startsWith('../') || refPath.startsWith('./')) {
                            refPath = resolveRelativePath(schemaPath, refPath);
                        } else if (!refPath.includes('/')) {
                            const baseDir = schemaPath.substring(0, schemaPath.lastIndexOf('/'));
                            refPath = baseDir ? `${baseDir}/${refPath}` : refPath;
                        }

                        // Skip if this is a reference to a primitive schema
                        if (isPrimitiveSchemaPath(refPath)) {
                            continue;
                        }
                        
                        // Also check the actual schema content if available
                        let actualRefPath = refPath;
                        let refSchema = schemas?.[refPath];
                        if (!refSchema && schemas) {
                            const matchingKey = Object.keys(schemas).find(key => 
                                key.endsWith(refPath) || refPath.endsWith(key)
                            );
                            if (matchingKey) {
                                refSchema = schemas[matchingKey];
                                actualRefPath = matchingKey;
                            }
                        }
                        
                        if (refSchema && isPrimitiveSchema(refSchema)) {
                            continue;
                        }

                        rules.push({
                            propertyPath: propName,
                            targetSchemaPath: actualRefPath,
                            cardinality: 'many',
                            required: requiredFields.has(propName)
                        });
                        break; // Only use first matching pattern
                    }
                }
            }
        }
    };

    // Helper to extract properties from a schema, including allOf compositions
    const getSchemaProperties = (schemaObj: any): Record<string, any> => {
        let properties: Record<string, any> = {};
        
        // Direct properties
        if (schemaObj.properties && typeof schemaObj.properties === 'object') {
            properties = { ...properties, ...schemaObj.properties };
        }
        
        // Properties inside allOf
        if (Array.isArray(schemaObj.allOf)) {
            for (const subSchema of schemaObj.allOf) {
                if (subSchema.properties && typeof subSchema.properties === 'object') {
                    properties = { ...properties, ...subSchema.properties };
                }
            }
        }
        
        return properties;
    };

    // Process properties (including those in allOf)
    const properties = getSchemaProperties(schema);
    Object.entries(properties).forEach(([propName, propValue]) => {
        processProperty(propName, propValue);
    });

    return rules;
};

export const extractSchemaReferences = (schema: any, schemaName: string): SchemaRelationship[] => {
    const refs: SchemaRelationship[] = [];

    const traverse = (obj: any, path: string = '', propertyName: string = '', parentIsArray: boolean = false) => {
        if (!obj || typeof obj !== 'object') return;
        if (obj.$ref && typeof obj.$ref === 'string') {
            const match = obj.$ref.match(/^([^#]+)/);
            if (match && match[1] && match[1].endsWith('.json')) {
                let refPath = match[1];

                if (refPath.startsWith('../') || refPath.startsWith('./')) {
                    refPath = resolveRelativePath(schemaName, refPath);
                } else if (!refPath.includes('/')) {
                    const baseDir = schemaName.substring(0, schemaName.lastIndexOf('/'));
                    refPath = baseDir ? `${baseDir}/${refPath}` : refPath;
                }

                const relationType: 'one-to-one' | 'one-to-many' = parentIsArray ? 'one-to-many' : 'one-to-one';

                refs.push({
                    from: schemaName,
                    to: refPath,
                    refPath: obj.$ref,
                    type: relationType,
                    propertyName: propertyName
                });
            }
        }
        if (obj.type === 'array' && obj.items) {
            traverse(obj.items, path, propertyName, true);
        }

        Object.entries(obj).forEach(([key, value]) => {
            if (typeof value === 'object' && value !== null && key !== 'items') {
                traverse(value, path, key, false);
            }
        });
    };

    traverse(schema);
    return refs;
};

const extractEntityType = (schemaPath: string): string => {
    const withoutExtension = schemaPath.replace(/\.schema\.json$/, '');

    const pathParts = withoutExtension.split('/');

    if (pathParts.length >= 2) {
        if (pathParts[0] === 'v1' && pathParts[1]) {
            return pathParts[1];
        }
    }

    const filename = pathParts[pathParts.length - 1];
    return filename || 'unknown';
};

export const createSchemaGraph = (
    schemas: Map<string, any>,
    relationships: SchemaRelationship[],
    expandedNodes: Set<string> = new Set()
): { nodes: Node[]; edges: Edge[] } => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const nodeIds = new Set<string>();

    schemas.forEach((schema, name) => {
        const title = schema.title || schema.$id || name;
        const isRoot = !relationships.some(r => r.to === name);
        const isExpanded = expandedNodes.has(name);
        const entityType = extractEntityType(name);

        const properties: string[] = [];
        if (schema.properties) {
            Object.keys(schema.properties).forEach(key => {
                const prop = schema.properties[key];
                const type = prop.type || 'any';
                properties.push(`${key}: ${type}`);
            });
        }

        nodes.push({
            id: name,
            type: 'schemaNode',
            data: {
                label: title,
                schemaName: name,
                isRoot,
                isExpanded,
                properties,
                schemaData: schema,
                entityType,
            },
            position: { x: 0, y: 0 },
        });
        nodeIds.add(name);
    });

    const edgeIds = new Set<string>();
    let matchedCount = 0;
    let unmatchedCount = 0;

    const relationshipGroups = new Map<string, SchemaRelationship[]>();
    relationships.forEach((rel) => {
        const key = `${rel.from}-${rel.to}`;
        if (!relationshipGroups.has(key)) {
            relationshipGroups.set(key, []);
        }
        relationshipGroups.get(key)!.push(rel);
    });

    relationshipGroups.forEach((rels) => {
        const rel = rels[0];

        const fromNode = nodeIds.has(rel.from) ? rel.from :
            Array.from(nodeIds).find(id => id.endsWith(rel.from)) || rel.from;
        const toNode = nodeIds.has(rel.to) ? rel.to :
            Array.from(nodeIds).find(id => id.endsWith(rel.to)) || rel.to;

        if (nodeIds.has(fromNode) && nodeIds.has(toNode)) {
            const edgeId = `${fromNode}-${toNode}`;
            if (!edgeIds.has(edgeId)) {
                let edgeColor: string;
                let edgeWidth: number;
                let edgeType: 'one-to-one' | 'one-to-many' | 'multiple';

                if (rels.length > 1) {
                    edgeColor = '#12a525ff';
                    edgeWidth = 2.5;
                    edgeType = 'multiple';
                } else if (rel.type === 'one-to-many') {
                    edgeColor = '#ff9800';
                    edgeWidth = 2;
                    edgeType = 'one-to-many';
                } else {
                    edgeColor = '#61dafb';
                    edgeWidth = 1;
                    edgeType = 'one-to-one';
                }

                edges.push({
                    id: edgeId,
                    source: fromNode,
                    target: toNode,
                    animated: true,
                    style: {
                        stroke: edgeColor,
                        strokeWidth: edgeWidth
                    },
                    data: {
                        type: edgeType,
                        propertyNames: rels.map(r => r.propertyName).filter(Boolean),
                        count: rels.length
                    }
                });
                edgeIds.add(edgeId);
                matchedCount++;
            }
        } else {
            unmatchedCount++;
        }
    });

    return { nodes, edges };
};
