'use client';

import React from 'react';
import { SimulationState } from '@/types/fleet';
import { Play, Pause, RotateCcw, Square, Activity, Sliders, Zap, Clock } from 'lucide-react';

interface FleetSimulatorControlsProps {
  fleetSize: number;
  simulationState: SimulationState;
  publishInterval: number;
  onScale: (size: number) => void;
  onControlSimulation: (action: 'start' | 'pause' | 'resume' | 'stop') => void;
  onChangeInterval: (interval: number) => void;
  onOpenConfig?: () => void;
}

export default function FleetSimulatorControls({
  fleetSize,
  simulationState,
  publishInterval,
  onScale,
  onControlSimulation,
  onChangeInterval,
  onOpenConfig,
}: FleetSimulatorControlsProps) {
  const handleDecrement = () => {
    if (fleetSize > 1) {
      onScale(fleetSize - 1);
    }
  };

  const handleIncrement = () => {
    if (fleetSize < 20) {
      onScale(fleetSize + 1);
    }
  };

  const isRunning = simulationState === 'RUNNING';
  const isPaused = simulationState === 'PAUSED';
  const isStopped = simulationState === 'STOPPED';

  return (
    <div className="bg-surface/90 border border-border/80 backdrop-blur-md rounded-xl p-4 sm:p-5 shadow-lg flex flex-col gap-4">
      {/* Title & Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-accent-blue/15 border border-accent-blue/30 flex items-center justify-center text-accent-blue">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-wider text-text-primary uppercase flex items-center gap-2">
              Fleet Simulation Control
            </h2>
            <p className="text-xs text-text-muted">
              Configure virtual edge devices and orchestrate real-time IoT telemetry loop
            </p>
          </div>
        </div>

        {/* State Badge */}
        <div className="flex items-center gap-2 bg-surface-2 px-3 py-1.5 rounded-full border border-border/70">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              isRunning
                ? 'bg-accent-green animate-pulse shadow-[0_0_8px_#10b981]'
                : isPaused
                ? 'bg-accent-yellow shadow-[0_0_8px_#f59e0b]'
                : 'bg-accent-red/80'
            }`}
          />
          <span className="text-xs font-mono font-medium tracking-wide">
            {simulationState}
          </span>
        </div>
      </div>

      {/* Main Controls Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
        {/* Fleet Size Controller (1–20) */}
        <div className="md:col-span-5 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-accent-blue" /> Fleet Size (1–20 Virtual EVs)
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onScale(1)}
                className={`text-[10px] px-1.5 py-0.5 rounded font-mono border transition-colors ${
                  fleetSize === 1
                    ? 'bg-accent-blue text-white border-accent-blue'
                    : 'bg-surface-2 text-text-muted border-border hover:text-text-primary'
                }`}
              >
                1
              </button>
              <button
                type="button"
                onClick={() => onScale(5)}
                className={`text-[10px] px-1.5 py-0.5 rounded font-mono border transition-colors ${
                  fleetSize === 5
                    ? 'bg-accent-blue text-white border-accent-blue'
                    : 'bg-surface-2 text-text-muted border-border hover:text-text-primary'
                }`}
              >
                5
              </button>
              <button
                type="button"
                onClick={() => onScale(10)}
                className={`text-[10px] px-1.5 py-0.5 rounded font-mono border transition-colors ${
                  fleetSize === 10
                    ? 'bg-accent-blue text-white border-accent-blue'
                    : 'bg-surface-2 text-text-muted border-border hover:text-text-primary'
                }`}
              >
                10
              </button>
              <button
                type="button"
                onClick={() => onScale(20)}
                className={`text-[10px] px-1.5 py-0.5 rounded font-mono border transition-colors ${
                  fleetSize === 20
                    ? 'bg-accent-blue text-white border-accent-blue'
                    : 'bg-surface-2 text-text-muted border-border hover:text-text-primary'
                }`}
              >
                20
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleDecrement}
              disabled={fleetSize <= 1}
              className="w-8 h-8 rounded-lg bg-surface-2 border border-border flex items-center justify-center text-text-primary font-bold hover:bg-surface-2/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Decrease fleet size"
            >
              −
            </button>

            <div className="flex-1 flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={20}
                step={1}
                value={fleetSize}
                onChange={(e) => onScale(parseInt(e.target.value, 10))}
                className="w-full h-2 bg-surface-2 rounded-lg appearance-none cursor-pointer accent-accent-blue"
              />
            </div>

            <button
              type="button"
              onClick={handleIncrement}
              disabled={fleetSize >= 20}
              className="w-8 h-8 rounded-lg bg-surface-2 border border-border flex items-center justify-center text-text-primary font-bold hover:bg-surface-2/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Increase fleet size"
            >
              +
            </button>

            <span className="w-16 text-right font-mono font-bold text-accent-blue text-sm">
              {fleetSize} {fleetSize === 1 ? 'EV' : 'EVs'}
            </span>
          </div>
        </div>

        {/* Lifecycle Action Buttons */}
        <div className="md:col-span-4 flex flex-col gap-2">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Engine Lifecycle
          </span>
          <div className="grid grid-cols-4 gap-1.5">
            <button
              type="button"
              onClick={() => onControlSimulation('start')}
              className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-xs font-medium border transition-all ${
                isRunning
                  ? 'bg-accent-green/20 text-accent-green border-accent-green/40 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                  : 'bg-surface-2 text-text-muted border-border hover:text-text-primary hover:border-accent-green/30'
              }`}
              title="Start simulation"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Start</span>
            </button>

            <button
              type="button"
              onClick={() => onControlSimulation('pause')}
              disabled={!isRunning}
              className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-xs font-medium border transition-all ${
                isPaused
                  ? 'bg-accent-yellow/20 text-accent-yellow border-accent-yellow/40 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
                  : 'bg-surface-2 text-text-muted border-border hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed'
              }`}
              title="Pause telemetry stream"
            >
              <Pause className="w-3.5 h-3.5" />
              <span>Pause</span>
            </button>

            <button
              type="button"
              onClick={() => onControlSimulation('resume')}
              disabled={!isPaused}
              className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-xs font-medium border transition-all ${
                isPaused
                  ? 'bg-accent-blue text-white border-accent-blue animate-pulse'
                  : 'bg-surface-2 text-text-muted border-border hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed'
              }`}
              title="Resume simulation"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Resume</span>
            </button>

            <button
              type="button"
              onClick={() => onControlSimulation('stop')}
              disabled={isStopped}
              className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-xs font-medium border transition-all ${
                isStopped
                  ? 'bg-accent-red/20 text-accent-red border-accent-red/40'
                  : 'bg-surface-2 text-text-muted border-border hover:text-accent-red disabled:opacity-40 disabled:cursor-not-allowed'
              }`}
              title="Stop simulation engine"
            >
              <Square className="w-3.5 h-3.5" />
              <span>Stop</span>
            </button>
          </div>
        </div>

        {/* Publish Interval Selector */}
        <div className="md:col-span-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-accent-blue" /> Interval
            </span>
            <span className="text-xs font-mono text-accent-blue">
              {publishInterval}s
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {[1, 2, 3, 5].map((sec) => (
              <button
                key={sec}
                type="button"
                onClick={() => onChangeInterval(sec)}
                className={`py-1.5 text-xs font-mono rounded-lg border transition-colors text-center ${
                  publishInterval === sec
                    ? 'bg-accent-blue/20 text-accent-blue border-accent-blue font-bold'
                    : 'bg-surface-2 text-text-muted border-border hover:text-text-primary'
                }`}
              >
                {sec}s
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
