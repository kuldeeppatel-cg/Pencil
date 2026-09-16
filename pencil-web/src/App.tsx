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
  Lock,
  Unlock,
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
const SHIELD_PRESET_HEIGHTS = [160, 240, 320, 420];

export default function App() {
  // --- Drawing State ---
  const [currentTool, setCurrentTool] = useState<ToolType>('PEN');
  const [selectedColor, setSelectedColor] = useState<string>('#0f172a');
  const [strokeSize, setStrokeSize] = useState<number>(4);
  const [paperStyle, setPaperStyle] = useState<PaperType>('ruled');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoStack, setRedoStack] = useState<Stroke[]>([]);

  // --- Palm Rejection & Palm Shield State ---
  const [palmMode, setPalmMode] = useState<PalmRejectionMode>('smart');
  const [showPalmShield, setShowPalmShield] = useState<boolean>(true);
  const [palmShieldHeight, setPalmShieldHeight] = useState<number>(240);
  const [isShieldLocked, setIsShieldLocked] = useState<boolean>(true);
  const [isPalmTouching, setIsPalmTouching] = useState<boolean>(false);
  const [pointerStatus, setPointerStatus] = useState<string>('Ready • Smart Palm Guard Active');
  const [isPointerBlocked, setIsPointerBlocked] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Canvas & Pointer Tracking Refs (Supports simultaneous palm-rest + inking)
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWrapperRef = useRef<HTMLDivElement | null>(null);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const isDrawingRef = useRef<boolean>(false);
  const activePointerIdRef = useRef<number | null>(null);
  const ignoredPointerIdsRef = useRef<Set<number>>(new Set());

  // --- Prevent ALL browser touch gestures, pan scrolling, and viewport bouncing ---
  useEffect(() => {
    const handleTouch = (e: TouchEvent) => {
      // Prevent browser default touch behavior (overscroll, pan, pinch)
      if (e.cancelable) {
        e.preventDefault();
      }
    };

    const handleGesture = (e: Event) => {
      if (e.cancelable) {
        e.preventDefault();
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    // Attach passive: false listeners to document and window to prevent container movement
    document.addEventListener('touchstart', handleTouch, { passive: false });
    document.addEventListener('touchmove', handleTouch, { passive: false });
    document.addEventListener('touchend', handleTouch, { passive: false });
    document.addEventListener('touchcancel', handleTouch, { passive: false });
    document.addEventListener('gesturestart', handleGesture, { passive: false });
    document.addEventListener('gesturechange', handleGesture, { passive: false });
    document.addEventListener('gestureend', handleGesture, { passive: false });
    document.addEventListener('contextmenu', handleContextMenu);

    return () => {
      document.removeEventListener('touchstart', handleTouch);
      document.removeEventListener('touchmove', handleTouch);
      document.removeEventListener('touchend', handleTouch);
      document.removeEventListener('touchcancel', handleTouch);
      document.removeEventListener('gesturestart', handleGesture);
      document.removeEventListener('gesturechange', handleGesture);
      document.removeEventListener('gestureend', handleGesture);
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

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

    // 4. Render All Completed Strokes
    const allStrokes = currentStrokeRef.current
      ? [...strokes, currentStrokeRef.current]
      : strokes;

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
  }, [strokes, paperStyle]);

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
  }, [renderCanvas]);

  // --- Pointer Coordinates Normalizer ---
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

  // --- Check if pointer falls inside Palm Rest Zone ---
  const isInsidePalmZone = (clientY: number) => {
    if (!showPalmShield || !canvasWrapperRef.current) return false;
    const rect = canvasWrapperRef.current.getBoundingClientRect();
    const palmThresholdY = rect.bottom - palmShieldHeight;
    return clientY >= palmThresholdY;
  };

  // --- Pointer Down (Start Inking with Palm Filtering) ---
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    // 1. If touch is inside the Palm Rest Shield zone -> Block it as palm rest!
    if (isInsidePalmZone(e.clientY)) {
      ignoredPointerIdsRef.current.add(e.pointerId);
      setIsPalmTouching(true);
      setPointerStatus('✋ Hand resting in Palm Guard Zone (Writing protected)');
      setIsPointerBlocked(false);
      return;
    }

    // 2. Hardware Stylus Mode (Strict Pen Only)
    if (palmMode === 'stylus' && e.pointerType !== 'pen') {
      ignoredPointerIdsRef.current.add(e.pointerId);
      setPointerStatus('🚫 Touch Ignored (Hardware Stylus Mode)');
      setIsPointerBlocked(true);
      return;
    }

    // 3. Smart Palm Detection: Check contact dimensions
    const isLargeContact = e.pointerType === 'touch' && (e.width > 26 || e.height > 26);
    if (palmMode === 'smart' && isLargeContact) {
      ignoredPointerIdsRef.current.add(e.pointerId);
      setIsPalmTouching(true);
      setPointerStatus('✋ Large Palm Contact Filtered');
      setIsPointerBlocked(true);
      return;
    }

    // 4. Multi-touch handling:
    if (activePointerIdRef.current !== null) {
      if (e.pointerType === 'pen') {
        // Priority to hardware pen
        if (currentStrokeRef.current) {
          setStrokes((prev) => [...prev, currentStrokeRef.current!]);
        }
        activePointerIdRef.current = null;
        currentStrokeRef.current = null;
      } else {
        // Secondary finger/hand contact while already writing -> ignore it
        ignoredPointerIdsRef.current.add(e.pointerId);
        return;
      }
    }

    // 5. Accept this pointer as the active drawing pointer
    activePointerIdRef.current = e.pointerId;
    isDrawingRef.current = true;
    setIsPointerBlocked(false);

    setPointerStatus(
      e.pointerType === 'pen'
        ? `✏️ Stylus Inking ${e.pressure ? `(${(e.pressure * 100).toFixed(0)}%)` : ''}`
        : '👆 Inking Active'
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
      id: `stroke_${Date.now()}_${Math.random()}`,
      tool: currentTool,
      color: currentTool === 'HIGHLIGHTER' && selectedColor === '#0f172a' ? '#facc15' : selectedColor,
      size: effectiveSize,
      opacity,
      points: [pt],
    };

    currentStrokeRef.current = newStroke;
    renderCanvas();
  };

  // --- Pointer Move (Smooth Vector Pathing) ---
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    // If it's an ignored palm contact, do nothing
    if (ignoredPointerIdsRef.current.has(e.pointerId)) {
      return;
    }

    // Only allow movement from the active writing pointer
    if (!isDrawingRef.current || !currentStrokeRef.current || e.pointerId !== activePointerIdRef.current) {
      return;
    }

    const pt = getCanvasCoords(e);
    currentStrokeRef.current.points.push(pt);
    renderCanvas();
  };

  // --- Pointer Up / End ---
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    // If it's an ignored palm pointer releasing, remove from set without stopping drawing!
    if (ignoredPointerIdsRef.current.has(e.pointerId)) {
      ignoredPointerIdsRef.current.delete(e.pointerId);
      if (ignoredPointerIdsRef.current.size === 0) {
        setIsPalmTouching(false);
      }
      return;
    }

    // If it's the active writing pointer releasing
    if (e.pointerId === activePointerIdRef.current) {
      isDrawingRef.current = false;
      activePointerIdRef.current = null;

      if (currentStrokeRef.current) {
        const finishedStroke = currentStrokeRef.current;
        setStrokes((prev) => [...prev, finishedStroke]);
        setRedoStack([]);
        currentStrokeRef.current = null;
        renderCanvas();
      }

      setPointerStatus(
        palmMode === 'smart'
          ? 'Ready • Smart Palm Guard Active'
          : palmMode === 'stylus'
          ? 'Ready • Stylus Only Mode'
          : 'Ready • Palm Guard Off'
      );
    }
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
    if (strokes.length === 0) return;
    if (window.confirm('Clear the canvas?')) {
      setStrokes([]);
      setRedoStack([]);
      currentStrokeRef.current = null;
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
            className="action-btn"
            onClick={handleUndo}
            disabled={strokes.length === 0}
            title="Undo"
          >
            <Undo2 size={18} />
          </button>

          <button
            className="action-btn"
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            title="Redo"
          >
            <Redo2 size={18} />
          </button>

          <button
            className="action-btn danger"
            onClick={handleClear}
            disabled={strokes.length === 0}
            title="Clear Canvas"
          >
            <Trash2 size={18} />
          </button>

          <button
            className="action-btn"
            onClick={handleExport}
            title="Export PNG"
          >
            <Download size={18} />
          </button>

          <button
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
              <option value="smart">Smart Palm (Finger & Pen)</option>
              <option value="stylus">Stylus Only (Apple Pencil / Active Pen)</option>
              <option value="off">Off (Allow All)</option>
            </select>
          </div>

          <div className="toggle-item">
            <Hand size={16} color={showPalmShield ? '#10b981' : '#94a3b8'} />
            <span className="toggle-label">Palm Shield</span>
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

      {/* --- Secondary Sub-Toolbar (Colors & Paper Options) --- */}
      <div className="secondary-bar">
        {/* Left: Color Palette */}
        <div className="sec-left">
          {currentTool !== 'ERASER' ? (
            <div className="color-palette">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
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
              🧹 Eraser Radius: {strokeSize * 4}px
            </div>
          )}
        </div>

        {/* Center: Paper Backgrounds */}
        <div className="sec-center">
          <div className="paper-selector">
            {(['ruled', 'grid', 'dots', 'blank', 'dark'] as PaperType[]).map((type) => (
              <button
                key={type}
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

      {/* --- Canvas Drawing Area (Fixed in place, non-scrolling) --- */}
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

        {/* Solid Non-Moving Palm Rest Shield Zone */}
        {showPalmShield && (
          <div
            className={`palm-rest-shield ${isPalmTouching ? 'touching' : ''}`}
            style={{ height: `${palmShieldHeight}px` }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              ignoredPointerIdsRef.current.add(e.pointerId);
              setIsPalmTouching(true);
              setPointerStatus('✋ Hand resting in Palm Guard Zone (Writing protected)');
            }}
            onPointerMove={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onPointerUp={(e) => {
              e.preventDefault();
              e.stopPropagation();
              ignoredPointerIdsRef.current.delete(e.pointerId);
              if (ignoredPointerIdsRef.current.size === 0) {
                setIsPalmTouching(false);
              }
            }}
            onPointerCancel={(e) => {
              e.preventDefault();
              e.stopPropagation();
              ignoredPointerIdsRef.current.delete(e.pointerId);
              if (ignoredPointerIdsRef.current.size === 0) {
                setIsPalmTouching(false);
              }
            }}
          >
            {/* Shield Top Border & Controls (Cannot be moved accidentally by resting palm) */}
            <div className="shield-header">
              <div className="shield-title-row">
                <div className="shield-title-group">
                  <span className="shield-title">
                    ✋ PALM REST GUARD ZONE ({palmShieldHeight}px)
                  </span>
                  <button
                    className={`shield-lock-btn ${isShieldLocked ? 'locked' : ''}`}
                    onClick={() => setIsShieldLocked((prev) => !prev)}
                    title={isShieldLocked ? 'Height Locked (Solid)' : 'Height Unlocked (Editable)'}
                  >
                    {isShieldLocked ? <Lock size={12} /> : <Unlock size={12} />}
                    <span>{isShieldLocked ? 'Locked' : 'Adjustable'}</span>
                  </button>
                </div>

                {!isShieldLocked && (
                  <div className="shield-presets">
                    {SHIELD_PRESET_HEIGHTS.map((h) => (
                      <button
                        key={h}
                        className={`shield-preset-btn ${palmShieldHeight === h ? 'active' : ''}`}
                        onClick={() => setPalmShieldHeight(h)}
                      >
                        {h}px
                      </button>
                    ))}
                  </div>
                )}

                <div className="shield-controls">
                  <button
                    className="shield-btn"
                    onClick={() => setPalmShieldHeight((h) => Math.min(h + 40, 480))}
                    title="Increase shield height"
                  >
                    ▲ Expand
                  </button>
                  <button
                    className="shield-btn"
                    onClick={() => setPalmShieldHeight((h) => Math.max(h - 40, 120))}
                    title="Decrease shield height"
                  >
                    ▼ Shrink
                  </button>
                </div>
              </div>
            </div>

            <div className="shield-surface-pattern">
              <div className="pattern-grid" />
              <div className="pattern-text">
                {isPalmTouching ? 'Hand Contact Absorbed • Safe to Write' : 'Rest Your Palm Comfortably Here'}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
