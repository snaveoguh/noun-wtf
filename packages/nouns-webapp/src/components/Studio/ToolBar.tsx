import { FC } from 'react';

import { Eraser, PaintBucket, Pencil, Pipette, RotateCcw, RotateCw, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { type Tool } from '@/components/Studio/PixelCanvas';

interface ToolBarProps {
  activeTool: Tool;
  onToolChange: (tool: Tool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const tools: { tool: Tool; icon: FC<{ className?: string }>; label: string }[] = [
  { tool: 'pencil', icon: Pencil, label: 'Pencil' },
  { tool: 'eraser', icon: Eraser, label: 'Eraser' },
  { tool: 'fill', icon: PaintBucket, label: 'Fill' },
  { tool: 'eyedropper', icon: Pipette, label: 'Eyedropper' },
];

export const ToolBar: FC<ToolBarProps> = ({
  activeTool,
  onToolChange,
  onUndo,
  onRedo,
  onClear,
  canUndo,
  canRedo,
}) => {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {tools.map(({ tool, icon: Icon, label }) => (
        <Button
          key={tool}
          variant={activeTool === tool ? 'default' : 'outline'}
          size="sm"
          onClick={() => onToolChange(tool)}
          title={label}
          className="h-9 w-9 p-0"
        >
          <Icon className="h-4 w-4" />
        </Button>
      ))}

      <div className="mx-2 h-6 w-px bg-gray-300" />

      <Button
        variant="outline"
        size="sm"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo"
        className="h-9 w-9 p-0"
      >
        <RotateCcw className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo"
        className="h-9 w-9 p-0"
      >
        <RotateCw className="h-4 w-4" />
      </Button>

      <div className="mx-2 h-6 w-px bg-gray-300" />

      <Button
        variant="outline"
        size="sm"
        onClick={onClear}
        title="Clear canvas"
        className="h-9 w-9 p-0 text-red-500 hover:text-red-700"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
};
