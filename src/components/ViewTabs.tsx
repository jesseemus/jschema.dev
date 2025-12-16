import React from 'react';
import { Code, Boxes } from 'lucide-react';
import './ViewTabs.css';

export type ViewMode = 'single' | 'multi' | 'builder';

interface ViewTabsProps {
  activeView: ViewMode;
  onViewChange: (view: ViewMode) => void;
  disabled?: boolean;
}

interface TabConfig {
  id: 'editor' | 'builder';
  label: string;
  icon: React.ReactNode;
  modes: ViewMode[];
}

const tabs: TabConfig[] = [
  {
    id: 'editor',
    label: 'Editor',
    icon: <Code size={16} />,
    modes: ['single', 'multi'],
  },
  {
    id: 'builder',
    label: 'Builder',
    icon: <Boxes size={16} />,
    modes: ['builder'],
  },
];

export const ViewTabs: React.FC<ViewTabsProps> = ({
  activeView,
  onViewChange,
  disabled = false,
}) => {
  const getActiveTab = (): 'editor' | 'builder' => {
    if (activeView === 'builder') return 'builder';
    // For 'single' and 'multi' modes, show Editor as active
    return 'editor';
  };

  const handleTabClick = (tabId: 'editor' | 'builder') => {
    if (disabled) return;

    if (tabId === 'editor') {
      onViewChange('multi');
    } else {
      onViewChange('builder');
    }
  };

  const activeTab = getActiveTab();

  return (
    <div className={`view-tabs ${disabled ? 'disabled' : ''}`}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`view-tab ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => handleTabClick(tab.id)}
          disabled={disabled}
          title={tab.label}
        >
          {tab.icon}
          <span className="view-tab-label">{tab.label}</span>
        </button>
      ))}
    </div>
  );
};

export default ViewTabs;
