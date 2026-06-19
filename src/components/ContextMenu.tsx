import * as RadixContextMenu from '@radix-ui/react-context-menu';
import type { ReactNode } from 'react';
import './ContextMenu.css';

interface ContextMenuProps {
  children: ReactNode;
  content: ReactNode;
}

export function ContextMenu({ children, content }: ContextMenuProps) {
  return (
    <RadixContextMenu.Root>
      <RadixContextMenu.Trigger asChild>
        {children}
      </RadixContextMenu.Trigger>
      
      <RadixContextMenu.Portal>
        <RadixContextMenu.Content 
          className="context-menu-content glass-panel"
        >
          {content}
        </RadixContextMenu.Content>
      </RadixContextMenu.Portal>
    </RadixContextMenu.Root>
  );
}

// Export a wrapper for the items to keep styling consistent
export function ContextMenuItem({ children, onClick, className = '' }: { children: ReactNode, onClick: () => void, className?: string }) {
  return (
    <RadixContextMenu.Item 
      className={`context-menu-item ${className}`}
      onSelect={onClick}
    >
      {children}
    </RadixContextMenu.Item>
  );
}
