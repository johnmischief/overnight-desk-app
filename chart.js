// Minimal equity sparkline. Values: array of numbers. Returns false when too few points.
window.drawEquity = function (canvas, values) {
  const c = canvas.getContext("2d"), w = canvas.width, h = canvas.height;
  c.clearRect(0, 0, w, h);
  if (!values || values.length < 2) return false;
  const min = Math.min(...values), max = Math.max(...values), span = (max - min) || 1;
  c.strokeStyle = "#ffc43d"; c.lineWidth = 2; c.beginPath();
  values.forEach((v, i) => {
    const x = i / (values.length - 1) * w, y = h - (v - min) / span * (h - 8) - 4;
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  });
  c.stroke();
  return true;
};
