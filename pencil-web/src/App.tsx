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
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // References for pure canvas inking
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWrapperRef = useRef<HTMLDivElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);

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

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;

    // Reset transform to exact DPR scale every frame
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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

    // 4. Render All Completed Strokes + Current In-Flight Stroke
    const allStrokes = currentStrokeRef.current
      ? [...strokesRef.current, currentStrokeRef.current]
      : strokesRef.current;

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

    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

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

  // --- Rock-Solid Unified Pointer & Multi-Touch Inking Engine ---
  const activePointerIdRef = useRef<number | null>(null);
  const palmPointerIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = canvasWrapperRef.current;
    if (!canvas || !wrapper) return;

    const getCanvasPoint = (e: PointerEvent): Point => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const pressure = e.pressure > 0 ? e.pressure : 0.5;
      return { x, y, pressure };
    };

    const getPalmThresholdY = () => {
      if (!showPalmShield || !canvasWrapperRef.current) return Infinity;
      const rect = canvasWrapperRef.current.getBoundingClientRect();
      return rect.bottom - palmShieldHeight;
    };

    const isPalmContact = (e: PointerEvent): boolean => {
      const palmY = getPalmThresholdY();

      // Stylus/Pen hardware tip is NEVER a palm - always allowed to ink
      if (e.pointerType === 'pen') {
        return false;
      }

      // Mouse is never a palm
      if (e.pointerType === 'mouse') {
        return false;
      }

      // 1. Any touch contact physically within the bottom Palm Rest Zone is 100% absorbed as palm
      if (e.clientY >= palmY) {
        return true;
      }

      // 2. Stylus-only mode: all touch inputs are rejected as palm
      if (palmMode === 'stylus' && e.pointerType === 'touch') {
        return true;
      }

      // 3. Smart mode: massive capacitive contact blobs (palm knuckles/heel) are palm
      if (palmMode === 'smart' && e.pointerType === 'touch') {
        const contactWidth = e.width || 0;
        const contactHeight = e.height || 0;
        if (contactWidth > 28 || contactHeight > 28) {
          return true;
        }
      }

      return false;
    };

    const handlePointerDown = (e: PointerEvent) => {
      // Ignore clicks on header, toolbars, or control buttons
      const target = e.target as HTMLElement | null;
      if (target?.closest('.top-header, .secondary-bar, .drawer-header-toolbar, .drawer-pull-tab')) {
        if (e.clientY >= getPalmThresholdY()) {
          palmPointerIdsRef.current.add(e.pointerId);
          setIsPalmTouching(true);
        }
        return;
      }

      // 1. Check if this pointer is a resting palm (e.g. anywhere in drawer or large blob)
      if (isPalmContact(e)) {
        palmPointerIdsRef.current.add(e.pointerId);
        setIsPalmTouching(true);
        setPointerStatus(`✋ Palm Absorbed (${palmPointerIdsRef.current.size} contacts) • Ready to write above`);
        return;
      }

      // 2. It is a legitimate inking tip (Pen/Stylus or Drawing Finger in writing area)!
      e.preventDefault();

      // If another pointer was already active and drawing, finalize it first
      if (currentStrokeRef.current && activePointerIdRef.current !== null && activePointerIdRef.current !== e.pointerId) {
        const finished = currentStrokeRef.current;
        setStrokes((prev) => [...prev, finished]);
        currentStrokeRef.current = null;
      }

      activePointerIdRef.current = e.pointerId;
      const pt = getCanvasPoint(e);

      let effectiveSize = strokeSize;
      let opacity = 1.0;
      if (currentTool === 'HIGHLIGHTER') {
        effectiveSize = Math.max(strokeSize * 3.5, 24);
        opacity = 0.38;
      } else if (currentTool === 'ERASER') {
        effectiveSize = Math.max(strokeSize * 4, 28);
        opacity = 1.0;
      }

      currentStrokeRef.current = {
        id: `stroke_${Date.now()}_${Math.random()}`,
        tool: currentTool,
        color: currentTool === 'HIGHLIGHTER' && selectedColor === '#0f172a' ? '#facc15' : selectedColor,
        size: effectiveSize,
        opacity,
        points: [pt],
      };

      setPointerStatus(
        e.pointerType === 'pen'
          ? `✏️ Stylus Inking ${e.pressure > 0 ? `(${(e.pressure * 100).toFixed(0)}%)` : ''}`
          : '👆 Drawing Active'
      );
      renderCanvas();
    };

    const handlePointerMove = (e: PointerEvent) => {
      // If this pointer is a resting palm contact, ignore it completely
      if (palmPointerIdsRef.current.has(e.pointerId)) {
        return;
      }

      // If this pointer is the active inking tip, append point and render
      if (e.pointerId === activePointerIdRef.current && currentStrokeRef.current) {
        e.preventDefault();
        const pt = getCanvasPoint(e);
        currentStrokeRef.current.points.push(pt);
        renderCanvas();
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      // 1. If it was a resting palm contact lifting
      if (palmPointerIdsRef.current.has(e.pointerId)) {
        palmPointerIdsRef.current.delete(e.pointerId);
        const remainingPalm = palmPointerIdsRef.current.size;
        setIsPalmTouching(remainingPalm > 0);
        if (remainingPalm > 0) {
          setPointerStatus(`✋ Palm Absorbed (${remainingPalm} contacts) • Ready to write above`);
        } else if (activePointerIdRef.current === null) {
          setPointerStatus(
            palmMode === 'smart'
              ? 'Ready • Palm Guard Active'
              : palmMode === 'stylus'
              ? 'Ready • Stylus Only Mode'
              : 'Ready • Palm Guard Off'
          );
        }
        return;
      }

      // 2. If it was the active inking tip lifting
      if (e.pointerId === activePointerIdRef.current) {
        if (currentStrokeRef.current) {
          const finished = currentStrokeRef.current;
          setStrokes((prev) => [...prev, finished]);
          setRedoStack([]);
          currentStrokeRef.current = null;
        }
        activePointerIdRef.current = null;
        renderCanvas();
        setPointerStatus(
          palmPointerIdsRef.current.size > 0
            ? `✋ Palm Absorbed (${palmPointerIdsRef.current.size} contacts) • Ready to write above`
            : palmMode === 'smart'
            ? 'Ready • Palm Guard Active'
            : palmMode === 'stylus'
            ? 'Ready • Stylus Only Mode'
            : 'Ready • Palm Guard Off'
        );
      }
    };

    const handlePointerCancel = (e: PointerEvent) => {
      handlePointerUp(e);
    };

    // Prevent default touch gestures (scrolling, zooming) strictly on canvas
    const handleTouchGesturePrevent = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('button, input, select, .drawer-header-toolbar, .top-header, .secondary-bar')) {
        e.preventDefault();
      }
    };

    wrapper.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    wrapper.addEventListener('touchstart', handleTouchGesturePrevent, { passive: false });
    wrapper.addEventListener('touchmove', handleTouchGesturePrevent, { passive: false });

    return () => {
      wrapper.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);

      wrapper.removeEventListener('touchstart', handleTouchGesturePrevent);
      wrapper.removeEventListener('touchmove', handleTouchGesturePrevent);
    };
  }, [showPalmShield, palmShieldHeight, palmMode, strokeSize, currentTool, selectedColor, renderCanvas]);

  // --- Drawer Pull Tab Dragging Handlers ---
  const handleDrawerDragStart = (e: React.PointerEvent) => {
    e.stopPropagation();
    isDraggingDrawerRef.current = true;
    setIsDrawerDragging(true);
    dragStartYRef.current = e.clientY;
    dragStartHeightRef.current = palmShieldHeight;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
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
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
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
    if (strokes.length === 0 && !currentStrokeRef.current) return;
    if (window.confirm('Clear the canvas?')) {
      setStrokes([]);
      setRedoStack([]);
      currentStrokeRef.current = null;
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
            <div className={`status-dot ${isPalmTouching ? 'palm-active' : ''}`} />
            <span className="status-text">{pointerStatus}</span>
          </div>
        </div>
      </div>

      {/* --- Canvas Drawing Area --- */}
      <main className="canvas-wrapper" ref={canvasWrapperRef}>
        {/* The single touch/drawing canvas */}
        <canvas
          ref={canvasRef}
          className="drawing-canvas"
        />

        {/* --- Palm Rest Guard Drawer Overlay --- */}
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
            <div className="drawer-header-toolbar">
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
