import React, { useState, useMemo, useCallback } from 'react';
import './FileExplorer.css';

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

interface FileExplorerProps {
  schemasMap: Map<string, any>;
  activeFile: string | null;
  openTabs: string[];
  onFileSelect: (path: string) => void;
  onAddFile?: (path: string, content: string) => void;
  onMoveFile?: (oldPath: string, newPath: string) => void;
  onDeleteFile?: (path: string) => void;
  onCopyFile?: (path: string) => void;
  onClearAll?: () => void;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  onSwitchToMultiMode?: () => void;
  onDragStateReset?: () => void;
}

type AddType = 'file' | 'folder' | null;

const FileIcon: React.FC<{ isDirectory: boolean; isExpanded?: boolean }> = ({ isDirectory, isExpanded }) => {
  if (isDirectory) {
    return <span className="file-icon">{isExpanded ? '📂' : '📁'}</span>;
  }
  return <span className="file-icon">📄</span>;
};

const TreeNode: React.FC<{
  node: FileNode;
  activeFile: string | null;
  openTabs: string[];
  onFileSelect: (path: string) => void;
  onDeleteFile?: (path: string) => void;
  onCopyFile?: (path: string) => void;
  level: number;
  isCompact?: boolean;
  onDragStart: (e: React.DragEvent, path: string, isDir: boolean) => void;
  onDragOver: (e: React.DragEvent, path: string, isDir: boolean) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, targetPath: string, isDir: boolean) => void;
  dragOverPath: string | null;
}> = ({ node, activeFile, openTabs, onFileSelect, onDeleteFile, onCopyFile, level, isCompact, onDragStart, onDragOver, onDragLeave, onDrop, dragOverPath }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showActions, setShowActions] = useState(false);

  const handleClick = () => {
    if (node.isDirectory) {
      setIsExpanded(!isExpanded);
    } else {
      onFileSelect(node.path);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDeleteFile) return;
    
    if (node.isDirectory) {
      if (confirm(`Delete folder "${node.name}" and all its contents?`)) {
        onDeleteFile(node.path);
      }
    } else {
      if (confirm(`Delete "${node.name}"?`)) {
        onDeleteFile(node.path);
      }
    }
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onCopyFile) {
      onCopyFile(node.path);
    }
  };

  const isOpen = openTabs.includes(node.path);
  const isActive = activeFile === node.path;
  const isDragOver = dragOverPath === node.path;

  return (
    <div className={`tree-node ${isCompact ? 'compact' : ''}`}>
      <div
        className={`tree-item ${isActive ? 'active' : ''} ${isOpen && !isActive ? 'open' : ''} ${isDragOver ? 'drag-over' : ''}`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleClick}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
        draggable={!node.isDirectory}
        onDragStart={(e) => onDragStart(e, node.path, node.isDirectory)}
        onDragOver={(e) => onDragOver(e, node.path, node.isDirectory)}
        onDragLeave={onDragLeave}
        onDrop={(e) => onDrop(e, node.path, node.isDirectory)}
      >
        {node.isDirectory && (
          <span className={`expand-icon ${isExpanded ? 'expanded' : ''}`}>▶</span>
        )}
        {!node.isDirectory && <span className="expand-icon-placeholder" />}
        <FileIcon isDirectory={node.isDirectory} isExpanded={isExpanded} />
        <span className="file-name">{node.name}</span>
        {showActions && (
          <div className="tree-item-actions">
            {!node.isDirectory && onCopyFile && (
              <button className="tree-action-btn" onClick={handleCopy} title="Copy file">
                📋
              </button>
            )}
            {onDeleteFile && (
              <button className="tree-action-btn delete" onClick={handleDelete} title={node.isDirectory ? "Delete folder" : "Delete file"}>
                🗑️
              </button>
            )}
          </div>
        )}
      </div>
      {node.isDirectory && isExpanded && node.children && (
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              activeFile={activeFile}
              openTabs={openTabs}
              onFileSelect={onFileSelect}
              onDeleteFile={onDeleteFile}
              onCopyFile={onCopyFile}
              level={level + 1}
              isCompact={isCompact}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              dragOverPath={dragOverPath}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const FileExplorer: React.FC<FileExplorerProps> = ({
  schemasMap,
  activeFile,
  openTabs,
  onFileSelect,
  onAddFile,
  onMoveFile,
  onDeleteFile,
  onCopyFile,
  onClearAll,
  isMaximized,
  onToggleMaximize,
  onSwitchToMultiMode,
  onDragStateReset,
}) => {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addType, setAddType] = useState<AddType>('file');
  const [newFileName, setNewFileName] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('');
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, path: string, isDir: boolean) => {
    if (isDir) {
      e.preventDefault();
      return;
    }
    setDraggedPath(path);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', path);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, path: string, isDir: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    
    const hasFiles = e.dataTransfer.types.includes('Files');
    
    if (hasFiles || draggedPath) {
      if (isDir) {
        e.dataTransfer.dropEffect = hasFiles ? 'copy' : 'move';
        setDragOverPath(path);
      }
    }
  }, [draggedPath]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOverPath(null);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, targetPath: string, isDir: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPath(null);
    onDragStateReset?.();
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0 && onAddFile) {
      for (const file of files) {
        if (file.name.endsWith('.json')) {
          try {
            const content = await file.text();
            JSON.parse(content);
            
            const fullPath = targetPath ? `${targetPath}/${file.name}` : file.name;
            onAddFile(fullPath, content);
          } catch (e) {
            console.error(`Failed to parse ${file.name}:`, e);
            alert(`Failed to parse JSON file: ${file.name}. Make sure it's valid JSON.`);
          }
        }
      }
      setDraggedPath(null);
      return;
    }
    
    if (!draggedPath || !isDir || !onMoveFile) {
      setDraggedPath(null);
      return;
    }
    
    const fileName = draggedPath.split('/').pop();
    if (!fileName) {
      setDraggedPath(null);
      return;
    }
    
    const newPath = targetPath ? `${targetPath}/${fileName}` : fileName;
    
    if (newPath !== draggedPath) {
      onMoveFile(draggedPath, newPath);
    }
    
    setDraggedPath(null);
  }, [draggedPath, onMoveFile, onAddFile, onDragStateReset]);

  // Get all folder paths from schemasMap
  const folderPaths = useMemo(() => {
    const folders = new Set<string>();
    folders.add(''); // Root folder
    
    Array.from(schemasMap.keys()).forEach(path => {
      const parts = path.split('/');
      // Build folder paths from file paths
      for (let i = 1; i < parts.length; i++) {
        folders.add(parts.slice(0, i).join('/'));
      }
    });
    
    return Array.from(folders).sort();
  }, [schemasMap]);

  const fileTree = useMemo(() => {
    const root: FileNode = {
      name: 'schemas',
      path: '',
      isDirectory: true,
      children: [],
    };

    const paths = Array.from(schemasMap.keys()).sort();

    paths.forEach((path) => {
      const parts = path.split('/');
      let current = root;

      parts.forEach((part, index) => {
        const isLast = index === parts.length - 1;
        const currentPath = parts.slice(0, index + 1).join('/');

        if (!current.children) {
          current.children = [];
        }

        let existing = current.children.find((c) => c.name === part);

        if (!existing) {
          existing = {
            name: part,
            path: currentPath,
            isDirectory: !isLast,
            children: isLast ? undefined : [],
          };
          current.children.push(existing);
          current.children.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
          });
        }

        current = existing;
      });
    });

    return root;
  }, [schemasMap]);

  const handleAddFile = () => {
    if (newFileName.trim() && onAddFile) {
      let fileName = newFileName.trim();
      
      // For files, ensure proper extension
      if (addType === 'file') {
        if (!fileName.endsWith('.json')) {
          fileName = fileName.endsWith('.schema') 
            ? fileName + '.json'
            : fileName + '.schema.json';
        }
      }
      
      // Prepend selected folder path
      const fullPath = selectedFolder 
        ? `${selectedFolder}/${fileName}`
        : fileName;
      
      if (addType === 'folder') {
        // Set the folder path as the selected folder for the next file creation
        setSelectedFolder(fullPath);
        setNewFileName('');
        setAddType('file');
        // Keep dialog open so user can add a file to the folder
        alert(`Folder "${fileName}" will be created when you add a file to it. The path is now set.`);
        return;
      } else {
        const defaultSchema = JSON.stringify({
          "$schema": "http://json-schema.org/draft-07/schema#",
          "type": "object",
          "properties": {}
        }, null, 2);
        onAddFile(fullPath, defaultSchema);
      }
      
      setNewFileName('');
      setSelectedFolder('');
      setAddType('file');
      setShowAddDialog(false);
    }
  };

  const openAddDialog = (type: AddType) => {
    setAddType(type);
    setShowAddDialog(true);
    setNewFileName('');
    setSelectedFolder('');
  };

  const hasFiles = fileTree.children && fileTree.children.length > 0;

  return (
    <div className={`file-explorer ${isMaximized ? 'maximized' : ''}`}>
      <div className="file-explorer-header">
        <span>EXPLORER</span>
        <div className="file-explorer-actions">
          {onSwitchToMultiMode && (
            <button 
              className="explorer-action-btn multi-mode-btn" 
              onClick={onSwitchToMultiMode}
              title="Switch to Multi-Schema Mode"
            >
              ⚡
            </button>
          )}
          {onAddFile && (
            <>
              <button 
                className="explorer-action-btn" 
                onClick={() => openAddDialog('file')}
                title="Add new file"
              >
                +
              </button>
              <button 
                className="explorer-action-btn" 
                onClick={() => openAddDialog('folder')}
                title="Add new folder"
              >
                📁+
              </button>
            </>
          )}
          {onClearAll && schemasMap.size > 0 && (
            <button 
              className="explorer-action-btn clear-all-btn" 
              onClick={() => {
                if (confirm('Delete all schemas and folders? This cannot be undone.')) {
                  onClearAll();
                }
              }}
              title="Clear all schemas"
            >
              🗑️
            </button>
          )}
          {onToggleMaximize && (
            <button 
              className="explorer-action-btn" 
              onClick={onToggleMaximize}
              title={isMaximized ? 'Minimize' : 'Maximize'}
            >
              {isMaximized ? '⊟' : '⊞'}
            </button>
          )}
        </div>
      </div>
      
      {showAddDialog && (
        <div className="add-file-dialog">
          <div className="add-dialog-header">
            {addType === 'folder' ? 'New Folder' : 'New File'}
          </div>
          {folderPaths.length > 1 && (
            <select
              className="folder-select"
              value={selectedFolder}
              onChange={(e) => setSelectedFolder(e.target.value)}
            >
              <option value="">/ (root)</option>
              {folderPaths.filter(f => f !== '').map(folder => (
                <option key={folder} value={folder}>/{folder}</option>
              ))}
            </select>
          )}
          <input
            type="text"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            placeholder={addType === 'folder' ? 'folder-name' : 'filename.schema.json'}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddFile();
              if (e.key === 'Escape') setShowAddDialog(false);
            }}
            autoFocus
          />
          <div className="add-file-actions">
            <button onClick={handleAddFile}>
              {addType === 'folder' ? 'Create Folder' : 'Add File'}
            </button>
            <button onClick={() => setShowAddDialog(false)}>Cancel</button>
          </div>
        </div>
      )}
      
      <div 
        className={`file-explorer-content ${isMaximized ? 'maximized-content' : ''} ${dragOverPath === '' ? 'drag-over-root' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const hasFiles = e.dataTransfer.types.includes('Files');
          if (draggedPath || hasFiles) {
            e.dataTransfer.dropEffect = hasFiles ? 'copy' : 'move';
            setDragOverPath('');
          }
        }}
        onDragLeave={(e) => {
          // Only clear if leaving the content area entirely
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragOverPath(null);
          }
        }}
        onDrop={(e) => handleDrop(e, '', true)}
      >
        {hasFiles ? (
          fileTree.children!.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              activeFile={activeFile}
              openTabs={openTabs}
              onFileSelect={onFileSelect}
              onDeleteFile={onDeleteFile}
              onCopyFile={onCopyFile}
              level={0}
              isCompact={!isMaximized}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              dragOverPath={dragOverPath}
            />
          ))
        ) : (
          <div className="empty-explorer">
            <p>No schemas loaded</p>
            {onAddFile && (
              <div className="empty-explorer-actions">
                <button 
                  className="add-first-file-btn"
                  onClick={() => openAddDialog('file')}
                >
                  + Add Schema
                </button>
                <button 
                  className="add-first-file-btn folder-btn"
                  onClick={() => openAddDialog('folder')}
                >
                  📁 Add Folder
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default FileExplorer;
