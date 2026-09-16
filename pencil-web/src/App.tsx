import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Pen,
  Highlighter,
  Eraser,
  Undo2,
  Redo2,
  Trash2,
  Download,
  Shield,
  Hand,
  Maximize,
  Minimize,
  Sparkles,
  ChevronUp,
  ChevronDown,
  GripHorizontal,
  Sliders,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import './App.css';

type ToolType = 'PEN' | 'HIGHLIGHTER' | 'ERASER';
type PaperType = 'ruled' | 'grid' | 'dots' | 'blank' | 'dark';
type PalmRejectionMode = 'smart' | 'stylus' | 'off';

interface Point {
  x: number;
  y: number;
  pressure?: number;
}

interface Stroke {
  id: string;
  tool: ToolType;
  color: string;
  size: number;
  opacity: number;
  points: Point[];
}

const PRESET_COLORS = [
  '#0f172a', // Slate Black
  '#2563eb', // Vivid Blue
  '#dc2626', // Crimson Red
  '#16a34a', // Emerald Green
  '#d97706', // Amber Orange
  '#9333ea', // Royal Purple
  '#facc15', // Neon Yellow
  '#4ade80', // Pastel Mint
  '#f472b6', // Coral Pink
  '#38bdf8', // Sky Blue
];

const STROKE_SIZES = [2, 4, 8, 14, 24];

const DRAWER_PRESETS = [
  { label: 'Min', height: 90 },
  { label: 'Compact', height: 180 },
  { label: 'Standard', height: 260 },
  { label: 'Expanded', height: 380 },
  { label: 'Max', height: 500 },
];

export default function App() {
  // --- Drawing State ---
  const [currentTool, setCurrentTool] = useState<ToolType>('PEN');
  const [selectedColor, setSelectedColor] = useState<string>('#0f172a');
  const [strokeSize, setStrokeSize] = useState<number>(4);
  const [paperStyle, setPaperStyle] = useState<PaperType>('ruled');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoStack, setRedoStack] = useState<Stroke[]>([]);

  // --- Palm Rejection & Palm Shield Drawer State ---
  const [palmMode, setPalmMode] = useState<PalmRejectionMode>('smart');
  const [showPalmShield, setShowPalmShield] = useState<boolean>(true);
  const [palmShieldHeight, setPalmShieldHeight] = useState<number>(260);
  const [isDrawerDragging, setIsDrawerDragging] = useState<boolean>(false);
  const [isPalmTouching, setIsPalmTouching] = useState<boolean>(false);
  const [pointerStatus, setPointerStatus] = useState<string>('Ready • Palm Guard Active');
  const [isPointerBlocked, setIsPointerBlocked] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // References for robust native inking
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWrapperRef = useRef<HTMLDivElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activeStrokesMapRef = useRef<Map<number | string, Stroke>>(new Map());
  const ignoredPointerIdsRef = useRef<Set<number | string>>(new Set());

  // Keep strokesRef in sync with state
  useEffect(() => {
    strokesRef.current = strokes;
  }, [strokes]);

  // Drawer Dragging Refs
  const isDraggingDrawerRef = useRef<boolean>(false);
  const dragStartYRef = useRef<number>(0);
  const dragStartHeightRef = useRef<number>(260);

  // --- Helper: Redraw All Canvas Strokes & Background Grid ---
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);

    // 1. Clear Canvas
    ctx.clearRect(0, 0, width, height);

    // 2. Fill Background Paper
    const isDark = paperStyle === 'dark';
    ctx.fillStyle = isDark ? '#090d16' : '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // 3. Draw Background Patterns
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.08)';
    ctx.strokeStyle = gridColor;
    ctx.fillStyle = gridColor;
    ctx.lineWidth = 1;

    if (paperStyle === 'ruled' || paperStyle === 'grid') {
      const stepY = 36;
      ctx.beginPath();
      for (let y = stepY * 2; y < height; y += stepY) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();
    }

    if (paperStyle === 'grid') {
      const stepX = 36;
      ctx.beginPath();
      for (let x = stepX; x < width; x += stepX) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      ctx.stroke();
    }

    if (paperStyle === 'dots') {
      const dotStep = 32;
      for (let x = dotStep; x < width; x += dotStep) {
        for (let y = dotStep * 2; y < height; y += dotStep) {
          ctx.beginPath();
          ctx.arc(x, y, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // 4. Render All Completed Strokes + In-Flight Active Strokes
    const inFlightStrokes = Array.from(activeStrokesMapRef.current.values());
    const allStrokes = [...strokesRef.current, ...inFlightStrokes];

    for (const stroke of allStrokes) {
      if (stroke.points.length === 0) continue;

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (stroke.tool === 'ERASER') {
        ctx.strokeStyle = isDark ? '#090d16' : '#ffffff';
        ctx.lineWidth = stroke.size;
        ctx.globalAlpha = 1.0;
      } else if (stroke.tool === 'HIGHLIGHTER') {
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size;
        ctx.globalAlpha = stroke.opacity;
        ctx.globalCompositeOperation = isDark ? 'lighter' : 'multiply';
      } else {
        ctx.strokeStyle = isDark && stroke.color === '#0f172a' ? '#f8fafc' : stroke.color;
        ctx.lineWidth = stroke.size;
        ctx.globalAlpha = stroke.opacity;
      }

      ctx.beginPath();
      const pts = stroke.points;
      if (pts.length === 1) {
        ctx.arc(pts[0].x, pts[0].y, stroke.size / 2, 0, Math.PI * 2);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
      } else {
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length - 1; i++) {
          const midX = (pts[i].x + pts[i + 1].x) / 2;
          const midY = (pts[i].y + pts[i + 1].y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.stroke();
      }

      ctx.restore();
    }
  }, [paperStyle]);

  // --- Resize Canvas on Window Resize & High DPI Scaling ---
  const handleResize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = parent.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
    }
    renderCanvas();
  }, [renderCanvas]);

  useEffect(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas, strokes]);

  // --- Native Touch Event Listeners Attached Directly to Canvas (Bulletproof Palm Isolation) ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const getTouchCoords = (touch: Touch): Point => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
        pressure: (touch as any).force || 0.5,
      };
    };

    const isTouchInPalmZone = (clientY: number) => {
      if (!showPalmShield || !canvasWrapperRef.current) return false;
      const rect = canvasWrapperRef.current.getBoundingClientRect();
      const palmThresholdY = rect.bottom - palmShieldHeight;
      return clientY >= palmThresholdY;
    };

    // 1. Native TouchStart
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault(); // Prevents browser from dropping touches or initiating gestures

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];

        // If touch lands inside Palm Rest Zone -> Absorb as Palm (No drawing)
        if (isTouchInPalmZone(touch.clientY)) {
          ignoredPointerIdsRef.current.add(touch.identifier);
          setIsPalmTouching(true);
          setPointerStatus('✋ Hand resting in Palm Guard Zone • Writing active above');
          continue;
        }

        // If Stylus only mode is active
        if (palmMode === 'stylus') {
          ignoredPointerIdsRef.current.add(touch.identifier);
          setPointerStatus('🚫 Touch Ignored (Stylus Only Mode)');
          setIsPointerBlocked(true);
          continue;
        }

        // Start Inking on Canvas
        setIsPointerBlocked(false);
        setPointerStatus('👆 Writing Active');

        const pt = getTouchCoords(touch);
        let effectiveSize = strokeSize;
        let opacity = 1.0;

        if (currentTool === 'HIGHLIGHTER') {
          effectiveSize = Math.max(strokeSize * 3.5, 24);
          opacity = 0.38;
        } else if (currentTool === 'ERASER') {
          effectiveSize = Math.max(strokeSize * 4, 28);
          opacity = 1.0;
        } else {
          effectiveSize = strokeSize;
          opacity = 1.0;
        }

        const newStroke: Stroke = {
          id: `stroke_${Date.now()}_${touch.identifier}_${Math.random()}`,
          tool: currentTool,
          color: currentTool === 'HIGHLIGHTER' && selectedColor === '#0f172a' ? '#facc15' : selectedColor,
          size: effectiveSize,
          opacity,
          points: [pt],
        };

        activeStrokesMapRef.current.set(touch.identifier, newStroke);
      }

      renderCanvas();
    };

    // 2. Native TouchMove
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault(); // Prevents page scrolling & rubberband bounce

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];

        if (ignoredPointerIdsRef.current.has(touch.identifier)) {
          continue;
        }

        if (activeStrokesMapRef.current.has(touch.identifier)) {
          const stroke = activeStrokesMapRef.current.get(touch.identifier)!;
          const pt = getTouchCoords(touch);
          stroke.points.push(pt);
        }
      }

      renderCanvas();
    };

    // 3. Native TouchEnd / TouchCancel
    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault();

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];

        ignoredPointerIdsRef.current.delete(touch.identifier);

        if (activeStrokesMapRef.current.has(touch.identifier)) {
          const finishedStroke = activeStrokesMapRef.current.get(touch.identifier)!;
          setStrokes((prev) => [...prev, finishedStroke]);
          setRedoStack([]);
          activeStrokesMapRef.current.delete(touch.identifier);
        }
      }

      if (ignoredPointerIdsRef.current.size === 0) {
        setIsPalmTouching(false);
      }

      renderCanvas();
    };

    // Attach non-passive native listeners to canvas
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });

    return () => {
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [showPalmShield, palmShieldHeight, palmMode, strokeSize, currentTool, selectedColor, renderCanvas]);

  // --- Pointer Coordinates Normalizer for Mouse / Active Stylus ---
  const getCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: e.pressure > 0 ? e.pressure : 0.5,
    };
  };

  const isInsidePalmZone = (clientY: number) => {
    if (!showPalmShield || !canvasWrapperRef.current) return false;
    const rect = canvasWrapperRef.current.getBoundingClientRect();
    const palmThresholdY = rect.bottom - palmShieldHeight;
    return clientY >= palmThresholdY;
  };

  // --- Pointer Handlers for Mouse & Active Hardware Stylus (Pen) ---
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Touch is already handled by native touch listeners above
    if (e.pointerType === 'touch') return;

    if (isInsidePalmZone(e.clientY)) {
      ignoredPointerIdsRef.current.add(e.pointerId);
      setIsPalmTouching(true);
      return;
    }

    setIsPointerBlocked(false);
    setPointerStatus(
      e.pointerType === 'pen'
        ? `✏️ Stylus Inking ${e.pressure ? `(${(e.pressure * 100).toFixed(0)}%)` : ''}`
        : '👆 Mouse Drawing Active'
    );

    const pt = getCanvasCoords(e);
    let effectiveSize = strokeSize;
    let opacity = 1.0;

    if (currentTool === 'HIGHLIGHTER') {
      effectiveSize = Math.max(strokeSize * 3.5, 24);
      opacity = 0.38;
    } else if (currentTool === 'ERASER') {
      effectiveSize = Math.max(strokeSize * 4, 28);
      opacity = 1.0;
    } else {
      effectiveSize = strokeSize;
      opacity = 1.0;
    }

    const newStroke: Stroke = {
      id: `stroke_${Date.now()}_${e.pointerId}_${Math.random()}`,
      tool: currentTool,
      color: currentTool === 'HIGHLIGHTER' && selectedColor === '#0f172a' ? '#facc15' : selectedColor,
      size: effectiveSize,
      opacity,
      points: [pt],
    };

    activeStrokesMapRef.current.set(e.pointerId, newStroke);
    renderCanvas();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'touch') return;

    if (ignoredPointerIdsRef.current.has(e.pointerId)) return;

    const activeStroke = activeStrokesMapRef.current.get(e.pointerId);
    if (!activeStroke) return;

    const pt = getCanvasCoords(e);
    activeStroke.points.push(pt);
    renderCanvas();
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'touch') return;

    ignoredPointerIdsRef.current.delete(e.pointerId);

    if (activeStrokesMapRef.current.has(e.pointerId)) {
      const finishedStroke = activeStrokesMapRef.current.get(e.pointerId)!;
      setStrokes((prev) => [...prev, finishedStroke]);
      setRedoStack([]);
      activeStrokesMapRef.current.delete(e.pointerId);
      renderCanvas();
    }
  };

  // --- Drawer Pull Tab Dragging Handlers ---
  const handleDrawerDragStart = (e: React.PointerEvent) => {
    e.stopPropagation();
    isDraggingDrawerRef.current = true;
    setIsDrawerDragging(true);
    dragStartYRef.current = e.clientY;
    dragStartHeightRef.current = palmShieldHeight;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleDrawerDragMove = (e: React.PointerEvent) => {
    if (!isDraggingDrawerRef.current) return;
    e.stopPropagation();
    const deltaY = dragStartYRef.current - e.clientY;
    const newHeight = Math.max(80, Math.min(dragStartHeightRef.current + deltaY, 540));
    setPalmShieldHeight(newHeight);
  };

  const handleDrawerDragEnd = (e: React.PointerEvent) => {
    if (!isDraggingDrawerRef.current) return;
    isDraggingDrawerRef.current = false;
    setIsDrawerDragging(false);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  // --- Drawer Increment / Decrement ---
  const expandDrawer = () => {
    setPalmShieldHeight((prev) => Math.min(prev + 60, 540));
  };

  const shrinkDrawer = () => {
    setPalmShieldHeight((prev) => Math.max(prev - 60, 80));
  };

  // --- Actions ---
  const handleUndo = () => {
    if (strokes.length === 0) return;
    const last = strokes[strokes.length - 1];
    setRedoStack((prev) => [...prev, last]);
    setStrokes((prev) => prev.slice(0, -1));
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const restored = redoStack[redoStack.length - 1];
    setStrokes((prev) => [...prev, restored]);
    setRedoStack((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    if (strokes.length === 0 && activeStrokesMapRef.current.size === 0) return;
    if (window.confirm('Clear the canvas?')) {
      setStrokes([]);
      setRedoStack([]);
      activeStrokesMapRef.current.clear();
      renderCanvas();
    }
  };

  const handleExport = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.2 },
    });

    const link = document.createElement('a');
    link.download = `drawing-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  return (
    <div className="app-container" onContextMenu={(e) => e.preventDefault()}>
      {/* --- Top Header & Main Toolbar --- */}
      <header className="top-header">
        <div className="brand-section">
          <div className="logo-badge">
            <Sparkles size={20} />
          </div>
          <div className="brand-text">
            <span className="brand-title">Pencil Studio</span>
            <span className="brand-subtitle">Smart Palm Rejection & Inking</span>
          </div>
        </div>

        {/* Primary Tool Selectors */}
        <div className="tools-cluster">
          <button
            type="button"
            className={`tool-btn ${currentTool === 'PEN' ? 'active' : ''}`}
            onClick={() => {
              setCurrentTool('PEN');
              if (selectedColor === '#facc15') setSelectedColor('#0f172a');
            }}
          >
            <Pen size={17} />
            <span>Pen</span>
          </button>

          <button
            type="button"
            className={`tool-btn ${currentTool === 'HIGHLIGHTER' ? 'active' : ''}`}
            onClick={() => {
              setCurrentTool('HIGHLIGHTER');
              setSelectedColor('#facc15');
            }}
          >
            <Highlighter size={17} />
            <span>Highlighter</span>
          </button>

          <button
            type="button"
            className={`tool-btn ${currentTool === 'ERASER' ? 'active' : ''}`}
            onClick={() => setCurrentTool('ERASER')}
          >
            <Eraser size={17} />
            <span>Eraser</span>
          </button>
        </div>

        {/* Stroke Width Selector */}
        <div className="size-cluster">
          {STROKE_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              className={`size-btn ${strokeSize === size ? 'active' : ''}`}
              onClick={() => setStrokeSize(size)}
            >
              <div
                className="size-dot"
                style={{
                  width: `${size + 2}px`,
                  height: `${size + 2}px`,
                }}
              />
            </button>
          ))}
        </div>

        {/* Action Controls */}
        <div className="actions-cluster">
          <button
            type="button"
            className="action-btn"
            onClick={handleUndo}
            disabled={strokes.length === 0}
            title="Undo"
          >
            <Undo2 size={18} />
          </button>

          <button
            type="button"
            className="action-btn"
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            title="Redo"
          >
            <Redo2 size={18} />
          </button>

          <button
            type="button"
            className="action-btn danger"
            onClick={handleClear}
            disabled={strokes.length === 0}
            title="Clear Canvas"
          >
            <Trash2 size={18} />
          </button>

          <button
            type="button"
            className="action-btn"
            onClick={handleExport}
            title="Export PNG"
          >
            <Download size={18} />
          </button>

          <button
            type="button"
            className="action-btn"
            onClick={toggleFullscreen}
            title="Toggle Fullscreen"
          >
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>

        {/* Palm Rejection Mode Selector */}
        <div className="palm-cluster">
          <div className="palm-mode-dropdown-wrap">
            <div className="palm-mode-label">
              <Shield size={16} color={palmMode === 'off' ? '#94a3b8' : '#3b82f6'} />
              <span>Palm Guard:</span>
            </div>
            <select
              className="palm-mode-select"
              value={palmMode}
              onChange={(e) => setPalmMode(e.target.value as PalmRejectionMode)}
              title="Select Palm Rejection Mode"
            >
              <option value="smart">Smart Palm Guard</option>
              <option value="stylus">Stylus Only (Apple Pencil / Active Pen)</option>
              <option value="off">Off (Allow All)</option>
            </select>
          </div>

          <div className="toggle-item">
            <Hand size={16} color={showPalmShield ? '#10b981' : '#94a3b8'} />
            <span className="toggle-label">Palm Drawer</span>
            <label className="switch">
              <input
                type="checkbox"
                checked={showPalmShield}
                onChange={(e) => setShowPalmShield(e.target.checked)}
              />
              <span className="slider green"></span>
            </label>
          </div>
        </div>
      </header>

      {/* --- Secondary Sub-Toolbar (Locked Grid) --- */}
      <div className="secondary-bar">
        {/* Left: Color Palette */}
        <div className="sec-left">
          {currentTool !== 'ERASER' ? (
            <div className="color-palette">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`color-swatch ${selectedColor === color ? 'active' : ''}`}
                  style={{ backgroundColor: color }}
                  onClick={() => setSelectedColor(color)}
                />
              ))}
              <input
                type="color"
                className="custom-color-picker"
                value={selectedColor}
                onChange={(e) => setSelectedColor(e.target.value)}
                title="Custom Color"
              />
            </div>
          ) : (
            <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>
              🧹 Eraser Active • Radius: {strokeSize * 4}px
            </div>
          )}
        </div>

        {/* Center: Paper Backgrounds */}
        <div className="sec-center">
          <div className="paper-selector">
            {(['ruled', 'grid', 'dots', 'blank', 'dark'] as PaperType[]).map((type) => (
              <button
                key={type}
                type="button"
                className={`paper-btn ${paperStyle === type ? 'active' : ''}`}
                onClick={() => setPaperStyle(type)}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Live Pointer & Palm Status Badge */}
        <div className="sec-right">
          <div className="status-badge">
            <div className={`status-dot ${isPointerBlocked ? 'blocked' : isPalmTouching ? 'palm-active' : ''}`} />
            <span className="status-text">{pointerStatus}</span>
          </div>
        </div>
      </div>

      {/* --- Canvas Drawing Area --- */}
      <main className="canvas-wrapper" ref={canvasWrapperRef}>
        <canvas
          ref={canvasRef}
          className="drawing-canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />

        {/* --- Pull-Up Palm Rest Guard Drawer Overlay --- */}
        {showPalmShield && (
          <div
            className={`palm-rest-drawer ${isPalmTouching ? 'touching' : ''} ${isDrawerDragging ? 'dragging' : ''}`}
            style={{ height: `${palmShieldHeight}px` }}
          >
            {/* Top Drawer Pull Tab & Grip Handle */}
            <div
              className="drawer-pull-tab"
              onPointerDown={handleDrawerDragStart}
              onPointerMove={handleDrawerDragMove}
              onPointerUp={handleDrawerDragEnd}
              onPointerCancel={handleDrawerDragEnd}
              title="Drag up or down to expand Palm Guard Drawer"
            >
              <div className="drawer-handle-bar">
                <GripHorizontal size={18} className="grip-icon" />
                <span className="drawer-handle-title">
                  ✋ PALM REST DRAWER ({palmShieldHeight}px)
                </span>
                <span className="drawer-drag-hint">↕ Pull to Expand</span>
              </div>
            </div>

            {/* Drawer Controls Bar (Preset buttons & Expand/Shrink actions) */}
            <div className="drawer-header-toolbar" onPointerDown={(e) => e.stopPropagation()}>
              <div className="drawer-preset-group">
                <span className="drawer-control-label">Presets:</span>
                {DRAWER_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className={`drawer-preset-btn ${Math.abs(palmShieldHeight - preset.height) < 25 ? 'active' : ''}`}
                    onClick={() => setPalmShieldHeight(preset.height)}
                  >
                    {preset.label} ({preset.height}px)
                  </button>
                ))}
              </div>

              {/* Range Slider for Smooth Height Adjustment */}
              <div className="drawer-slider-group">
                <Sliders size={13} color="#94a3b8" />
                <input
                  type="range"
                  min="80"
                  max="540"
                  step="10"
                  value={palmShieldHeight}
                  onChange={(e) => setPalmShieldHeight(Number(e.target.value))}
                  className="drawer-height-slider"
                  title="Adjust Drawer Height"
                />
              </div>

              {/* Step Buttons */}
              <div className="drawer-step-controls">
                <button
                  type="button"
                  className="drawer-action-btn"
                  onClick={expandDrawer}
                  title="Expand Drawer Up"
                >
                  <ChevronUp size={15} />
                  <span>Expand</span>
                </button>
                <button
                  type="button"
                  className="drawer-action-btn"
                  onClick={shrinkDrawer}
                  title="Shrink Drawer Down"
                >
                  <ChevronDown size={15} />
                  <span>Shrink</span>
                </button>
              </div>
            </div>

            {/* Resting Hand Surface (Pass-through to canvas palm filter) */}
            <div className="drawer-surface-pattern">
              <div className="pattern-grid" />
              <div className="pattern-text">
                {isPalmTouching ? 'Hand Contact Absorbed • Safe to Write Above' : 'Rest Your Whole Palm or Hand Here'}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
