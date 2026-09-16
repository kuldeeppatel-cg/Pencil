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
} from 'lucide-react';
import confetti from 'canvas-confetti';
import './App.css';

type ToolType = 'PEN' | 'HIGHLIGHTER' | 'ERASER';
type PaperType = 'ruled' | 'grid' | 'dots' | 'blank' | 'dark';

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

export default function App() {
  // --- Drawing State ---
  const [currentTool, setCurrentTool] = useState<ToolType>('PEN');
  const [selectedColor, setSelectedColor] = useState<string>('#0f172a');
  const [strokeSize, setStrokeSize] = useState<number>(4);
  const [paperStyle, setPaperStyle] = useState<PaperType>('ruled');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoStack, setRedoStack] = useState<Stroke[]>([]);

  // --- Palm Guard State ---
  const [isPalmGuardActive, setIsPalmGuardActive] = useState<boolean>(true);
  const [showPalmShield, setShowPalmShield] = useState<boolean>(false);
  const [palmShieldHeight, setPalmShieldHeight] = useState<number>(220);
  const [pointerStatus, setPointerStatus] = useState<string>('Palm Guard: Active');
  const [isPointerBlocked, setIsPointerBlocked] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Canvas Refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const isDrawingRef = useRef<boolean>(false);

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

  // --- Pointer Down (Start Inking) ---
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Palm Rejection Filter: Reject Finger/Touch if Stylus Only mode is active
    if (isPalmGuardActive && e.pointerType === 'touch') {
      setPointerStatus('Palm/Finger Blocked (Stylus Mode)');
      setIsPointerBlocked(true);
      return;
    }

    setIsPointerBlocked(false);
    setPointerStatus(
      e.pointerType === 'pen'
        ? `Stylus Inking ${e.pressure ? `(${(e.pressure * 100).toFixed(0)}%)` : ''}`
        : 'Touch Inking'
    );

    // Capture pointer for uninterrupted tracking
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    isDrawingRef.current = true;

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
    if (!isDrawingRef.current || !currentStrokeRef.current) return;

    // Reject if palm guard active
    if (isPalmGuardActive && e.pointerType === 'touch') {
      return;
    }

    const pt = getCanvasCoords(e);
    currentStrokeRef.current.points.push(pt);
    renderCanvas();
  };

  // --- Pointer Up / End ---
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    if (currentStrokeRef.current) {
      const finishedStroke = currentStrokeRef.current;
      setStrokes((prev) => [...prev, finishedStroke]);
      setRedoStack([]);
      currentStrokeRef.current = null;
      renderCanvas();
    }

    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
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
    <div className="app-container">
      {/* --- Top Header & Main Toolbar --- */}
      <header className="top-header">
        <div className="brand-section">
          <div className="logo-badge">
            <Sparkles size={20} />
          </div>
          <div className="brand-text">
            <span className="brand-title">Pencil Studio</span>
            <span className="brand-subtitle">Tablet Inking & Palm Guard</span>
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

        {/* Palm Guard Switches */}
        <div className="palm-cluster">
          <div className="toggle-item">
            <Shield size={16} color={isPalmGuardActive ? '#3b82f6' : '#94a3b8'} />
            <span className="toggle-label">Stylus Only</span>
            <label className="switch">
              <input
                type="checkbox"
                checked={isPalmGuardActive}
                onChange={(e) => setIsPalmGuardActive(e.target.checked)}
              />
              <span className="slider"></span>
            </label>
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
        {/* Color Palette */}
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

        {/* Paper Backgrounds */}
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

        {/* Live Pointer & Palm Status Badge */}
        <div className="status-badge">
          <div className={`status-dot ${isPointerBlocked ? 'blocked' : ''}`} />
          <span className="status-text">{pointerStatus}</span>
        </div>
      </div>

      {/* --- Canvas Drawing Area --- */}
      <main className="canvas-wrapper">
        <canvas
          ref={canvasRef}
          className="drawing-canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />

        {/* Draggable/Adjustable Palm Rest Shield (For Capacitive Screens) */}
        {showPalmShield && (
          <div
            className="palm-rest-shield"
            style={{ height: `${palmShieldHeight}px` }}
            onPointerDown={(e) => e.stopPropagation()} // Absorbs hand contact
          >
            <div className="shield-header">
              <div className="shield-drag-bar" />
              <div className="shield-title-row">
                <span className="shield-title">
                  ✋ PALM REST GUARD ZONE (Hand touches blocked here)
                </span>
                <div className="shield-controls">
                  <button
                    className="shield-btn"
                    onClick={() => setPalmShieldHeight((h) => Math.min(h + 60, 480))}
                  >
                    ▲ Expand
                  </button>
                  <button
                    className="shield-btn"
                    onClick={() => setPalmShieldHeight((h) => Math.max(h - 60, 100))}
                  >
                    ▼ Shrink
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
