// components/EnergyDashboard.jsx
// Phase 5 — live KE / PE / Total energy line chart using Chart.js.

import { useEffect, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import Matter from 'matter-js';
import { calculateEnergy } from '../simulation/energyCalculator.js';
import './EnergyDashboard.css';

Chart.register(LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, Legend);

const MAX_POINTS = 120; // 12 seconds at 10 Hz
const SAMPLE_MS  = 100; // sample every 100 ms

export default function EnergyDashboard({ engineRef, visible }) {
  const [keData,  setKeData]  = useState([]);
  const [peData,  setPeData]  = useState([]);
  const [totData, setTotData] = useState([]);

  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => {
      const engine = engineRef?.current;
      if (!engine) return;
      const bodies = Matter.Composite.allBodies(engine.world);
      if (bodies.length === 0) return;
      const { ke, pe, total } = calculateEnergy(bodies);
      const push = (setter, val) =>
        setter(prev => [...prev.slice(-(MAX_POINTS - 1)), Math.abs(val)]);
      push(setKeData,  ke);
      push(setPeData,  pe);
      push(setTotData, total);
    }, SAMPLE_MS);
    return () => clearInterval(id);
  }, [engineRef, visible]);

  const labels = keData.map((_, i) => '');

  const data = {
    labels,
    datasets: [
      {
        label: 'KE',
        data: keData,
        borderColor: '#FF6B35',
        backgroundColor: 'rgba(255,107,53,0.08)',
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 1.5,
      },
      {
        label: '|PE|',
        data: peData,
        borderColor: '#4ECDC4',
        backgroundColor: 'rgba(78,205,196,0.06)',
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 1.5,
      },
      {
        label: 'Total',
        data: totData,
        borderColor: '#a64dff',
        backgroundColor: 'transparent',
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 1,
        borderDash: [4, 3],
      },
    ],
  };

  const options = {
    animation: false,
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        labels: {
          color: '#7878a0',
          font: { size: 9, family: 'Outfit' },
          boxWidth: 10,
          padding: 8,
        },
      },
      tooltip: { enabled: false },
    },
    scales: {
      x: { display: false },
      y: {
        display: true,
        ticks: {
          color: '#4a4a6a',
          font: { size: 8 },
          maxTicksLimit: 4,
          callback: v => v > 999 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0),
        },
        grid: { color: 'rgba(122,0,255,0.08)' },
        border: { display: false },
      },
    },
  };

  if (!visible) return null;

  return (
    <div className="energy-dashboard glass-panel" id="energy-dashboard">
      <div className="ed-header">
        <span className="ed-title">Energy</span>
        <span className="ed-unit">arbitrary units</span>
      </div>
      <div className="ed-chart">
        <Line data={data} options={options} />
      </div>
    </div>
  );
}
