import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { FileExplorer } from './FileExplorer';
import { SchemaTab } from './SchemaTab';
import { editorStorage } from '../utils/editorStorage';
import './SchemaTab.css';
import './MultiSchemaEditor.css';

interface JsonEditorProps {
    value: string;
    onChange: (value: string | undefined) => void;
    onPropertyClick?: (property: string) => void;
    schemasMap?: Map<string, any>;
    onAddSchema?: (path: string, content: string) => void;
    onMoveFile?: (oldPath: string, newPath: string) => void;
    onDeleteFile?: (path: string) => void;
    onCopyFile?: (path: string) => void;
    onClearAll?: () => void;
    onSwitchToMultiMode?: () => void;
    onDragStateReset?: () => void;
}

interface MultiSchemaEditorProps {
    schemasMap: Map<string, any>;
    onPropertyClick?: (property: string) => void;
    onSchemaChange?: (path: string, content: string) => void;
    onAddSchema?: (path: string, content: string) => void;
    onMoveFile?: (oldPath: string, newPath: string) => void;
    onDeleteFile?: (path: string) => void;
    onCopyFile?: (path: string) => void;
    onClearAll?: () => void;
    selectedSchemaPath?: string | null;
    onFileSelect?: (path: string) => void;
    onDragStateReset?: () => void;
}

// Helper to register $ref autocomplete
const registerRefAutocomplete = (monaco: any, schemasMap: Map<string, any>) => {
    return monaco.languages.registerCompletionItemProvider('json', {
        triggerCharacters: ['"', ':', ' ', '/'],
        provideCompletionItems: (model: any, position: any) => {
            const lineContent = model.getLineContent(position.lineNumber);
            const textUntilPosition = lineContent.substring(0, position.column - 1);
            
            // Check if we're in a $ref value context
            // Pattern 1: "$ref": "  or "$ref": "partial
            const refValueMatch = textUntilPosition.match(/"\$ref"\s*:\s*"([^"]*)$/);
            if (refValueMatch) {
                const existingValue = refValueMatch[1] || '';
                const quotePos = textUntilPosition.lastIndexOf('"');
                
                const suggestions = Array.from(schemasMap.keys())
                    .filter(path => path.toLowerCase().includes(existingValue.toLowerCase()))
                    .map(path => ({
                        label: path,
                        kind: monaco.languages.CompletionItemKind.Reference,
                        insertText: path,
                        range: {
                            startLineNumber: position.lineNumber,
                            endLineNumber: position.lineNumber,
                            startColumn: quotePos + 2,
                            endColumn: position.column
                        },
                        detail: 'Schema reference',
                        documentation: `Reference to ${path}`,
                        sortText: '0' + path,
                    }));
                
                return { suggestions };
            }
            
            // Pattern 2: cursor is between quotes in "$ref": ""
            const fullRefMatch = lineContent.match(/"\$ref"\s*:\s*"([^"]*)"/);
            if (fullRefMatch) {
                const colonPos = lineContent.indexOf(':', lineContent.indexOf('"$ref"'));
                const valueQuoteStart = lineContent.indexOf('"', colonPos);
                const valueQuoteEnd = lineContent.indexOf('"', valueQuoteStart + 1);
                
                if (position.column - 1 > valueQuoteStart && position.column - 1 <= valueQuoteEnd) {
                    const existingValue = lineContent.substring(valueQuoteStart + 1, position.column - 1);
                    
                    const suggestions = Array.from(schemasMap.keys())
                        .filter(path => path.toLowerCase().includes(existingValue.toLowerCase()))
                        .map(path => ({
                            label: path,
                            kind: monaco.languages.CompletionItemKind.Reference,
                            insertText: path,
                            range: {
                                startLineNumber: position.lineNumber,
                                endLineNumber: position.lineNumber,
                                startColumn: valueQuoteStart + 2,
                                endColumn: valueQuoteEnd + 1
                            },
                            detail: 'Schema reference',
                            documentation: `Reference to ${path}`,
                            sortText: '0' + path,
                        }));
                    
                    return { suggestions };
                }
            }
            
            return { suggestions: [] };
        }
    });
};

// Single-file editor component with optional file explorer
export const JsonEditor: React.FC<JsonEditorProps> = ({ 
    value, 
    onChange, 
    onPropertyClick,
    schemasMap,
    onAddSchema,
    onMoveFile,
    onDeleteFile,
    onCopyFile,
    onClearAll,
    onSwitchToMultiMode,
    onDragStateReset
}) => {
    const [isMaximized, setIsMaximized] = useState(false);
    const [openTabs, setOpenTabs] = useState<string[]>([]);
    const [activeFile, setActiveFile] = useState<string | null>(null);
    const [monacoInstance, setMonacoInstance] = useState<any>(null);
    const completionDisposableRef = React.useRef<any>(null);

    // Re-register autocomplete when schemasMap changes
    useEffect(() => {
        if (monacoInstance && schemasMap && schemasMap.size > 0) {
            // Dispose old provider first
            if (completionDisposableRef.current) {
                completionDisposableRef.current.dispose();
                completionDisposableRef.current = null;
            }
            // Register new provider with updated schemasMap
            completionDisposableRef.current = registerRefAutocomplete(monacoInstance, schemasMap);
        }
        
        // Cleanup on unmount or when dependencies change
        return () => {
            if (completionDisposableRef.current) {
                completionDisposableRef.current.dispose();
                completionDisposableRef.current = null;
            }
        };
    }, [monacoInstance, schemasMap]);

    const handleFileSelect = useCallback((path: string) => {
        // In single mode, clicking a file just navigates to it visually
        if (!openTabs.includes(path)) {
            setOpenTabs(prev => [...prev, path]);
        }
        setActiveFile(path);
        
        // Trigger property click to navigate in visualizer
        if (onPropertyClick) {
            const fileName = path.split('/').pop() || path;
            onPropertyClick(fileName);
        }
    }, [openTabs, onPropertyClick]);

    const handleEditorDidMount: OnMount = (editor, monaco) => {
        monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
            validate: true,
            schemas: [],
        });
        
        // Store monaco instance for autocomplete registration
        setMonacoInstance(monaco);
        
        if (onPropertyClick) {
            editor.onMouseDown((e) => {
                const position = e.target.position;
                if (position) {
                    const model = editor.getModel();
                    if (model) {
                        const lineContent = model.getLineContent(position.lineNumber);
                        
                        const jsonMatch = lineContent.match(/([a-zA-Z0-9._-]+\.json)/);
                        if (jsonMatch) {
                            onPropertyClick(jsonMatch[1]);
                            return;
                        }
                        
                        const word = model.getWordAtPosition(position);
                        if (word) {
                            onPropertyClick(word.word);
                        }
                    }
                }
            });
        }
    };

    const showExplorer = (schemasMap && schemasMap.size > 0) || onAddSchema;
    const canSwitchToMulti = schemasMap && schemasMap.size >= 1 && onSwitchToMultiMode;

    return (
        <div className={`json-editor-container ${isMaximized ? 'maximized' : ''}`}>
            {showExplorer && (
                <div className={`explorer-section ${isMaximized ? 'maximized' : ''}`}>
                    <FileExplorer
                        schemasMap={schemasMap || new Map()}
                        activeFile={activeFile}
                        openTabs={openTabs}
                        onFileSelect={handleFileSelect}
                        onAddFile={onAddSchema}
                        onMoveFile={onMoveFile}
                        onDeleteFile={onDeleteFile}
                        onCopyFile={onCopyFile}
                        onClearAll={onClearAll}
                        isMaximized={isMaximized}
                        onToggleMaximize={() => setIsMaximized(!isMaximized)}
                        onSwitchToMultiMode={canSwitchToMulti ? onSwitchToMultiMode : undefined}
                        onDragStateReset={onDragStateReset}
                    />
                </div>
            )}
            <div className="editor-section">
                <Editor
                    height="100%"
                    defaultLanguage="json"
                    value={value}
                    onChange={onChange}
                    theme="vs-dark"
                    options={{
                        minimap: { enabled: false },
                        fontSize: 14,
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                    }}
                    onMount={handleEditorDidMount}
                />
            </div>
        </div>
    );
};

// Multi-schema editor with file explorer and tabs
export const MultiSchemaEditor: React.FC<MultiSchemaEditorProps> = ({
    schemasMap,
    onPropertyClick,
    onSchemaChange,
    onAddSchema,
    onMoveFile,
    onDeleteFile,
    onCopyFile,
    onClearAll,
    selectedSchemaPath,
    onFileSelect: onFileSelectProp,
    onDragStateReset,
}) => {
    const [openTabs, setOpenTabs] = useState<string[]>([]);
    const [activeFile, setActiveFile] = useState<string | null>(null);
    const [editedContent, setEditedContent] = useState<Record<string, string>>({});
    const [isMaximized, setIsMaximized] = useState(false);
    const [monacoInstance, setMonacoInstance] = useState<any>(null);
    const completionDisposableRef = React.useRef<any>(null);
    
    // Re-register autocomplete when schemasMap changes
    useEffect(() => {
        if (monacoInstance && schemasMap.size > 0) {
            // Dispose old provider first
            if (completionDisposableRef.current) {
                completionDisposableRef.current.dispose();
                completionDisposableRef.current = null;
            }
            // Register new provider with updated schemasMap
            completionDisposableRef.current = registerRefAutocomplete(monacoInstance, schemasMap);
        }
        
        // Cleanup on unmount or when dependencies change
        return () => {
            if (completionDisposableRef.current) {
                completionDisposableRef.current.dispose();
                completionDisposableRef.current = null;
            }
        };
    }, [monacoInstance, schemasMap]);

    // Open file when selectedSchemaPath changes (from node click)
    useEffect(() => {
        if (selectedSchemaPath && schemasMap.has(selectedSchemaPath)) {
            if (!openTabs.includes(selectedSchemaPath)) {
                setOpenTabs(prev => [...prev, selectedSchemaPath]);
            }
            setActiveFile(selectedSchemaPath);
        }
    }, [selectedSchemaPath, schemasMap]);

    // Load persisted state on mount
    useEffect(() => {
        const savedState = editorStorage.loadFullState();
        
        // Filter tabs to only include files that exist in schemasMap
        const validTabs = savedState.openTabs.filter(tab => schemasMap.has(tab));
        setOpenTabs(validTabs);
        
        // Set active file if it exists
        if (savedState.activeFile && schemasMap.has(savedState.activeFile)) {
            setActiveFile(savedState.activeFile);
        } else if (validTabs.length > 0) {
            setActiveFile(validTabs[0]);
        }
        
        // Load edited content
        setEditedContent(savedState.editedContent);
    }, [schemasMap]);

    // Persist state when it changes
    useEffect(() => {
        editorStorage.saveOpenTabs(openTabs);
    }, [openTabs]);

    useEffect(() => {
        editorStorage.saveActiveFile(activeFile);
    }, [activeFile]);

    const handleFileSelect = useCallback((path: string) => {
        if (!openTabs.includes(path)) {
            setOpenTabs(prev => [...prev, path]);
        }
        setActiveFile(path);
        
        // Trigger zoom to node in visualizer
        if (onFileSelectProp) {
            onFileSelectProp(path);
        } else if (onPropertyClick) {
            const fileName = path.split('/').pop() || path;
            onPropertyClick(fileName);
        }
    }, [openTabs, onFileSelectProp, onPropertyClick]);

    const handleTabSelect = useCallback((path: string) => {
        setActiveFile(path);
    }, []);

    const handleTabClose = useCallback((e: React.MouseEvent, path: string) => {
        e.stopPropagation();
        
        const newTabs = openTabs.filter(tab => tab !== path);
        setOpenTabs(newTabs);
        
        if (activeFile === path) {
            const closedIndex = openTabs.indexOf(path);
            if (newTabs.length > 0) {
                const newActiveIndex = Math.min(closedIndex, newTabs.length - 1);
                setActiveFile(newTabs[newActiveIndex]);
            } else {
                setActiveFile(null);
            }
        }
        
        editorStorage.removeEditedContent(path);
        setEditedContent(prev => {
            const newContent = { ...prev };
            delete newContent[path];
            return newContent;
        });
    }, [openTabs, activeFile]);

    const handleEditorChange = useCallback((value: string | undefined) => {
        if (activeFile && value !== undefined) {
            setEditedContent(prev => ({
                ...prev,
                [activeFile]: value,
            }));
            editorStorage.saveEditedContent(activeFile, value);
            onSchemaChange?.(activeFile, value);
        }
    }, [activeFile, onSchemaChange]);

    const getCurrentContent = useCallback((): string => {
        if (!activeFile) return '';
        
        if (editedContent[activeFile] !== undefined) {
            return editedContent[activeFile];
        }
        
        const originalSchema = schemasMap.get(activeFile);
        if (originalSchema) {
            return typeof originalSchema === 'string' 
                ? originalSchema 
                : JSON.stringify(originalSchema, null, 2);
        }
        
        return '';
    }, [activeFile, editedContent, schemasMap]);

    const isDirty = useCallback((path: string): boolean => {
        if (editedContent[path] === undefined) return false;
        
        const originalSchema = schemasMap.get(path);
        if (!originalSchema) return false;
        
        const originalStr = typeof originalSchema === 'string'
            ? originalSchema
            : JSON.stringify(originalSchema, null, 2);
        
        return editedContent[path] !== originalStr;
    }, [editedContent, schemasMap]);

    const handleEditorDidMount: OnMount = useCallback((editor, monaco) => {
        monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
            validate: true,
            schemas: [],
        });
        
        // Store monaco instance for autocomplete registration
        setMonacoInstance(monaco);
        
        if (onPropertyClick) {
            editor.onMouseDown((e) => {
                const position = e.target.position;
                if (position) {
                    const model = editor.getModel();
                    if (model) {
                        const lineContent = model.getLineContent(position.lineNumber);
                        
                        const jsonMatch = lineContent.match(/([a-zA-Z0-9._-]+\.json)/);
                        if (jsonMatch) {
                            onPropertyClick(jsonMatch[1]);
                            return;
                        }
                        
                        const word = model.getWordAtPosition(position);
                        if (word) {
                            onPropertyClick(word.word);
                        }
                    }
                }
            });
        }
    }, [onPropertyClick, schemasMap]);

    const currentContent = useMemo(() => getCurrentContent(), [getCurrentContent]);

    return (
        <div className={`multi-schema-editor ${isMaximized ? 'maximized' : ''}`}>
            <div className={`explorer-section ${isMaximized ? 'maximized' : ''}`}>
                <FileExplorer
                    schemasMap={schemasMap}
                    activeFile={activeFile}
                    openTabs={openTabs}
                    onFileSelect={handleFileSelect}
                    onAddFile={onAddSchema}
                    onMoveFile={onMoveFile}
                    onDeleteFile={onDeleteFile}
                    onCopyFile={onCopyFile}
                    onClearAll={onClearAll}
                    isMaximized={isMaximized}
                    onToggleMaximize={() => setIsMaximized(!isMaximized)}
                    onDragStateReset={onDragStateReset}
                />
            </div>
            <div className="editor-area">
                <div className="tab-bar">
                    {openTabs.length > 0 ? (
                        openTabs.map(path => (
                            <SchemaTab
                                key={path}
                                path={path}
                                isActive={path === activeFile}
                                isDirty={isDirty(path)}
                                onSelect={() => handleTabSelect(path)}
                                onClose={(e) => handleTabClose(e, path)}
                            />
                        ))
                    ) : (
                        <span className="empty-tabs">No files open</span>
                    )}
                </div>
                <div className="editor-content">
                    {activeFile ? (
                        <Editor
                            key={activeFile}
                            height="100%"
                            defaultLanguage="json"
                            value={currentContent}
                            onChange={handleEditorChange}
                            theme="vs-dark"
                            options={{
                                minimap: { enabled: false },
                                fontSize: 14,
                                scrollBeyondLastLine: false,
                                automaticLayout: true,
                            }}
                            onMount={handleEditorDidMount}
                        />
                    ) : (
                        <div className="no-file-open">
                            <p>Select a file from the explorer to edit</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
