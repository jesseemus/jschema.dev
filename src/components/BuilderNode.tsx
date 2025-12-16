import React, { useMemo, useCallback } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Trash2 } from 'lucide-react';
import { getSchemaConnectionRules, type ConnectionRule } from '../utils/schemaRelationships';
import './BuilderNode.css';

/**
 * Schema property definition
 */
export interface SchemaProperty {
  name: string;
  type: string;
  format?: string;
  description?: string;
  required: boolean;
  isRef: boolean;
  enum?: string[];
}

export interface BuilderNodeData {
  label: string;
  schemaPath: string;
  instanceId: string;
  schemaTitle: string;
  schemas: Record<string, object>;
  values?: Record<string, any>;
  onValueChange?: (instanceId: string, propertyName: string, value: any) => void;
  onDeleteNode?: (instanceId: string) => void;
  connectedHandles?: Set<string>;
  validTargetHandles?: Set<string>;
  isValidConnectionTarget?: boolean;
}

interface BuilderNodeProps extends NodeProps<BuilderNodeData> {}

/**
 * Generate a consistent color for a schema based on its path
 */
const getSchemaColor = (schemaPath: string): { border: string; background: string; accent: string } => {
  let hash = 0;
  for (let i = 0; i < schemaPath.length; i++) {
    hash = schemaPath.charCodeAt(i) + ((hash << 5) - hash);
  }

  const goldenRatio = 0.618033988749895;
  const hue = (Math.abs(hash) * goldenRatio * 360) % 360;
  const saturation = 65 + (Math.abs(hash >> 8) % 20);
  const lightness = 55 + (Math.abs(hash >> 16) % 15);

  const border = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  const background = `hsl(${hue}, ${saturation}%, ${Math.max(lightness - 35, 15)}%)`;
  const accent = `hsl(${hue}, ${saturation}%, ${lightness + 10}%)`;

  return { border, background, accent };
};

export const BuilderNode: React.FC<BuilderNodeProps> = ({ data, selected }) => {
  const {
    schemaPath,
    instanceId,
    schemaTitle,
    schemas,
    values = {},
    onValueChange,
    onDeleteNode,
    connectedHandles = new Set(),
    validTargetHandles = new Set(),
    isValidConnectionTarget = false,
  } = data;

  // Get connection rules for this schema
  const connectionRules = useMemo<ConnectionRule[]>(() => {
    const schema = schemas[schemaPath];
    if (!schema) return [];
    return getSchemaConnectionRules(schema, schemaPath);
  }, [schemas, schemaPath]);

  // Get primitive (non-ref) properties from schema
  const primitiveProperties = useMemo<SchemaProperty[]>(() => {
    const schema = schemas[schemaPath] as Record<string, any> | undefined;
    if (!schema?.properties) return [];
    
    const refPropertyPaths = new Set(connectionRules.map(rule => rule.propertyPath));
    const requiredProps = new Set(schema.required || []);
    
    return Object.entries(schema.properties)
      .filter(([name]) => !refPropertyPaths.has(name))
      .map(([name, propDef]: [string, any]) => ({
        name,
        type: propDef.type || 'string',
        format: propDef.format,
        description: propDef.description,
        required: requiredProps.has(name),
        isRef: false,
        enum: propDef.enum,
      }));
  }, [schemas, schemaPath, connectionRules]);

  // Generate color based on schema
  const colors = useMemo(() => getSchemaColor(schemaPath), [schemaPath]);

  // Handle value change
  const handleInputChange = useCallback((propertyName: string, value: any) => {
    if (onValueChange) {
      onValueChange(instanceId, propertyName, value);
    }
  }, [onValueChange, instanceId]);

  // Check if this node has any outgoing connections available
  const hasSourceHandles = connectionRules.length > 0;
  const hasPrimitiveProps = primitiveProperties.length > 0;

  // Handle delete button click
  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDeleteNode) {
      onDeleteNode(instanceId);
    }
  }, [onDeleteNode, instanceId]);

  return (
    <div
      className={`builder-node ${selected ? 'selected' : ''} ${isValidConnectionTarget ? 'valid-target' : ''}`}
      style={{
        borderColor: colors.border,
        backgroundColor: colors.background,
      }}
    >
      {/* Target handle for incoming connections - on the left */}
      <Handle
        type="target"
        position={Position.Left}
        id="target"
        className={`builder-handle target-handle ${validTargetHandles.has('target') ? 'valid-target' : ''}`}
      />

      {/* Node header */}
      <div className="builder-node-header">
        <span className="builder-node-title">{schemaTitle}</span>
        <span className="builder-node-instance">({instanceId})</span>
        <button 
          className="builder-node-delete nodrag" 
          onClick={handleDelete}
          title="Delete node"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Primitive properties with input fields */}
      {hasPrimitiveProps && (
        <div className="builder-node-inputs">
          {primitiveProperties.map((prop) => (
            <div key={prop.name} className="builder-node-input-row">
              <label 
                className={`input-label ${prop.required ? 'required' : ''}`}
                title={prop.description || prop.name}
              >
                {prop.name}
                {prop.required && <span className="property-required-indicator">*</span>}
              </label>
              {prop.enum ? (
                <select
                  className="builder-input builder-select nodrag"
                  value={values[prop.name] ?? ''}
                  onChange={(e) => handleInputChange(prop.name, e.target.value || null)}
                >
                  <option value="">Select...</option>
                  {prop.enum.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : prop.type === 'boolean' ? (
                <select
                  className="builder-input builder-select nodrag"
                  value={values[prop.name] === true ? 'true' : values[prop.name] === false ? 'false' : ''}
                  onChange={(e) => handleInputChange(prop.name, e.target.value === 'true' ? true : e.target.value === 'false' ? false : null)}
                >
                  <option value="">Select...</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : prop.type === 'integer' || prop.type === 'number' ? (
                <input
                  type="number"
                  className="builder-input nodrag"
                  placeholder={prop.format || prop.type}
                  value={values[prop.name] ?? ''}
                  onChange={(e) => handleInputChange(prop.name, e.target.value ? Number(e.target.value) : null)}
                  step={prop.type === 'integer' ? 1 : 'any'}
                />
              ) : (
                <input
                  type={prop.format === 'email' ? 'email' : prop.format === 'uri' ? 'url' : 'text'}
                  className="builder-input nodrag"
                  placeholder={prop.format || prop.type}
                  value={values[prop.name] ?? ''}
                  onChange={(e) => handleInputChange(prop.name, e.target.value || null)}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Source handles for each $ref property - on the right */}
      {hasSourceHandles && (
        <div className="builder-node-properties">
          {connectionRules.map((rule) => {
            const isConnected = connectedHandles.has(rule.propertyPath);
            const isRequired = rule.required;
            const isArray = rule.cardinality === 'many';

            return (
              <div key={rule.propertyPath} className="builder-node-property">
                <span
                  className={`property-label ${isRequired ? 'required' : ''} ${isConnected ? 'connected' : ''}`}
                  title={`${rule.propertyPath} → ${rule.targetSchemaPath}${isArray ? ' (array)' : ''}${isRequired ? ' (required)' : ''}`}
                >
                  {rule.propertyPath}
                  {isArray && <span className="property-array-indicator">[]</span>}
                  {isRequired && <span className="property-required-indicator">*</span>}
                </span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={rule.propertyPath}
                  className={`builder-handle source-handle ${isConnected ? 'connected' : ''} ${isArray ? 'array' : 'single'}`}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Show a message if no content */}
      {!hasSourceHandles && !hasPrimitiveProps && (
        <div className="builder-node-no-refs">
          <span className="no-refs-text">No properties</span>
        </div>
      )}
    </div>
  );
};

export default BuilderNode;
