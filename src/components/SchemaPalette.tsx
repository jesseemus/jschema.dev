import React, { useMemo, useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, GripVertical, Database, Search, X } from 'lucide-react';
import { groupSchemasByFolder, type SchemaInfo } from '../utils/builderTypes';
import './SchemaPalette.css';

interface SchemaPaletteProps {
  schemas: Record<string, object>;
}

interface SchemaItemProps {
  schema: SchemaInfo;
  onDragStart: (e: React.DragEvent, schemaPath: string) => void;
}

const SchemaItem: React.FC<SchemaItemProps> = ({ schema, onDragStart }) => {
  const handleDragStart = useCallback((e: React.DragEvent) => {
    onDragStart(e, schema.path);
  }, [onDragStart, schema.path]);

  return (
    <div
      className="palette-schema-item"
      draggable
      onDragStart={handleDragStart}
      title={schema.description || `Drag to add ${schema.title}`}
    >
      <GripVertical className="palette-drag-handle" size={14} />
      <Database className="palette-schema-icon" size={14} />
      <span className="palette-schema-title">{schema.title}</span>
    </div>
  );
};

interface SchemaGroupProps {
  name: string;
  schemas: SchemaInfo[];
  onDragStart: (e: React.DragEvent, schemaPath: string) => void;
  defaultExpanded?: boolean;
}

const SchemaGroup: React.FC<SchemaGroupProps> = ({ 
  name, 
  schemas, 
  onDragStart,
  defaultExpanded = true 
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const toggleExpanded = useCallback(() => {
    setIsExpanded(prev => !prev);
  }, []);

  return (
    <div className="palette-group">
      <div className="palette-group-header" onClick={toggleExpanded}>
        {isExpanded ? (
          <ChevronDown className="palette-group-chevron" size={14} />
        ) : (
          <ChevronRight className="palette-group-chevron" size={14} />
        )}
        <span className="palette-group-name">{name}</span>
        <span className="palette-group-count">{schemas.length}</span>
      </div>
      {isExpanded && (
        <div className="palette-group-items">
          {schemas.map((schema) => (
            <SchemaItem
              key={schema.path}
              schema={schema}
              onDragStart={onDragStart}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const SchemaPalette: React.FC<SchemaPaletteProps> = ({ schemas }) => {
  const [searchQuery, setSearchQuery] = useState('');

  // Group schemas by folder
  const schemaGroups = useMemo(() => {
    return groupSchemasByFolder(schemas);
  }, [schemas]);

  // Sort group names
  const sortedGroupNames = useMemo(() => {
    return Array.from(schemaGroups.keys()).sort();
  }, [schemaGroups]);

  // Filter groups and schemas based on search query
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) {
      return sortedGroupNames.map(name => ({
        name,
        schemas: schemaGroups.get(name)!,
        matchedByGroup: false,
      }));
    }

    const query = searchQuery.toLowerCase().trim();
    const result: { name: string; schemas: SchemaInfo[]; matchedByGroup: boolean }[] = [];

    for (const groupName of sortedGroupNames) {
      const groupSchemas = schemaGroups.get(groupName)!;
      const groupNameMatches = groupName.toLowerCase().includes(query);

      if (groupNameMatches) {
        // If group name matches, show all schemas in that group
        result.push({ name: groupName, schemas: groupSchemas, matchedByGroup: true });
      } else {
        // Otherwise, filter individual schemas
        const matchingSchemas = groupSchemas.filter(schema => 
          schema.title.toLowerCase().includes(query) ||
          schema.path.toLowerCase().includes(query) ||
          (schema.description && schema.description.toLowerCase().includes(query))
        );
        if (matchingSchemas.length > 0) {
          result.push({ name: groupName, schemas: matchingSchemas, matchedByGroup: false });
        }
      }
    }

    return result;
  }, [searchQuery, sortedGroupNames, schemaGroups]);

  const handleDragStart = useCallback((e: React.DragEvent, schemaPath: string) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/schema-path', schemaPath);
    e.dataTransfer.setData('text/plain', schemaPath);
    
    // Add a custom drag image (optional enhancement)
    const dragElement = e.currentTarget as HTMLElement;
    if (dragElement) {
      e.dataTransfer.setDragImage(dragElement, 20, 20);
    }
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
  }, []);

  const schemaCount = Object.keys(schemas).length;
  const filteredCount = filteredGroups.reduce((sum, g) => sum + g.schemas.length, 0);

  return (
    <div className="schema-palette">
      <div className="palette-header">
        <span className="palette-title">Schema Palette</span>
        <span className="palette-count">{schemaCount}</span>
      </div>
      <div className="palette-search">
        <Search className="palette-search-icon" size={14} />
        <input
          type="text"
          className="palette-search-input"
          placeholder="Search schemas..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button className="palette-search-clear" onClick={handleClearSearch} title="Clear search">
            <X size={14} />
          </button>
        )}
      </div>
      <div className="palette-content">
        {schemaCount === 0 ? (
          <div className="palette-empty">
            <p>No schemas available</p>
            <p className="palette-empty-hint">Load schemas to start building</p>
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="palette-empty">
            <p>No matches found</p>
            <p className="palette-empty-hint">Try a different search term</p>
          </div>
        ) : (
          <>
            {searchQuery && (
              <div className="palette-search-results">
                Showing {filteredCount} of {schemaCount} schemas
              </div>
            )}
            {filteredGroups.map(({ name, schemas: groupSchemas, matchedByGroup }) => (
              <SchemaGroup
                key={name}
                name={name}
                schemas={groupSchemas}
                onDragStart={handleDragStart}
                defaultExpanded={!!searchQuery || matchedByGroup}
              />
            ))}
          </>
        )}
      </div>
      <div className="palette-footer">
        <p>Drag schemas onto the canvas</p>
      </div>
    </div>
  );
};

export default SchemaPalette;
