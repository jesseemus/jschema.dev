import React from 'react';
import './SchemaTab.css';
import { FaFile } from 'react-icons/fa6';
import { IoMdClose } from 'react-icons/io';

interface SchemaTabProps {
  path: string;
  isActive: boolean;
  isDirty: boolean;
  onSelect: () => void;
  onClose: (e: React.MouseEvent) => void;
}

export const SchemaTab: React.FC<SchemaTabProps> = ({
  path,
  isActive,
  isDirty,
  onSelect,
  onClose,
}) => {
  const fileName = path.split('/').pop() || path;

  return (
    <div
      className={`schema-tab ${isActive ? 'active' : ''}`}
      onClick={onSelect}
      title={path}
    >
      <span className="tab-icon"><FaFile /></span>
      <span className="tab-name">{fileName}</span>
      {isDirty && <span className="dirty-indicator">●</span>}
      <button
        className="tab-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose(e);
        }}
        title="Close"
      >
        <IoMdClose />
      </button>
    </div>
  );
};

export default SchemaTab;
