const { createCanvas } = require('canvas');
const fs = require('fs');

const W = 1024, H = 1024;
const c = createCanvas(W, H);
const ctx = c.getContext('2d');

// === Background: warm dark gradient ===
const bg = ctx.createLinearGradient(0, 0, W, H);
bg.addColorStop(0, '#2a1a0e');
bg.addColorStop(0.5, '#1a0e06');
bg.addColorStop(1, '#0e0804');
ctx.fillStyle = bg;
ctx.fillRect(0, 0, W, H);

// === Warm light source upper-left ===
const light = ctx.createRadialGradient(180, 120, 20, 250, 200, 700);
light.addColorStop(0, 'rgba(255, 200, 100, 0.25)');
light.addColorStop(0.3, 'rgba(200, 140, 60, 0.12)');
light.addColorStop(1, 'rgba(0, 0, 0, 0)');
ctx.fillStyle = light;
ctx.fillRect(0, 0, W, H);

// === Wooden table surface ===
const tableY = 620;
const tableGrad = ctx.createLinearGradient(0, tableY, 0, H);
tableGrad.addColorStop(0, '#6b4226');
tableGrad.addColorStop(0.15, '#5a3720');
tableGrad.addColorStop(0.5, '#4d2e1a');
tableGrad.addColorStop(1, '#3a2010');
ctx.fillStyle = tableGrad;
ctx.fillRect(0, tableY, W, H - tableY);

// Wood grain lines
ctx.globalAlpha = 0.15;
for (let i = 0; i < 12; i++) {
  const y = tableY + 20 + i * 32 + Math.random() * 10;
  ctx.strokeStyle = i % 2 ? '#3a2010' : '#7a5030';
  ctx.lineWidth = 1 + Math.random() * 2;
  ctx.beginPath();
  ctx.moveTo(0, y);
  for (let x = 0; x < W; x += 40) {
    ctx.lineTo(x, y + Math.sin(x * 0.01) * 3 + Math.random() * 2);
  }
  ctx.stroke();
}
ctx.globalAlpha = 1;

// Table front edge highlight
const edgeGrad = ctx.createLinearGradient(0, tableY - 4, 0, tableY + 8);
edgeGrad.addColorStop(0, '#8a6040');
edgeGrad.addColorStop(1, '#5a3720');
ctx.fillStyle = edgeGrad;
ctx.fillRect(0, tableY - 2, W, 10);

// === Draped cloth ===
// Main cloth body
ctx.fillStyle = '#d4c4a0';
ctx.beginPath();
ctx.moveTo(50, tableY + 10);
ctx.bezierCurveTo(150, tableY - 30, 350, tableY + 20, 500, tableY - 10);
ctx.bezierCurveTo(580, tableY + 10, 620, tableY + 40, 680, tableY + 80);
ctx.bezierCurveTo(720, tableY + 160, 650, tableY + 280, 600, H);
ctx.lineTo(50, H);
ctx.closePath();
ctx.fill();

// Cloth fold shadows
ctx.fillStyle = '#b0a080';
ctx.beginPath();
ctx.moveTo(120, tableY + 20);
ctx.bezierCurveTo(180, tableY + 60, 220, tableY + 30, 280, tableY + 70);
ctx.bezierCurveTo(320, tableY + 100, 300, tableY + 200, 250, H);
ctx.lineTo(120, H);
ctx.closePath();
ctx.fill();

ctx.fillStyle = '#9a8a68';
ctx.beginPath();
ctx.moveTo(380, tableY + 15);
ctx.bezierCurveTo(420, tableY + 50, 460, tableY + 30, 500, tableY + 60);
ctx.bezierCurveTo(530, tableY + 120, 520, tableY + 220, 480, H);
ctx.lineTo(380, H);
ctx.closePath();
ctx.fill();

// Cloth highlight
ctx.fillStyle = '#e8dcc0';
ctx.beginPath();
ctx.moveTo(200, tableY);
ctx.bezierCurveTo(250, tableY - 15, 330, tableY + 5, 370, tableY);
ctx.bezierCurveTo(370, tableY + 40, 300, tableY + 60, 200, tableY + 30);
ctx.closePath();
ctx.fill();

// === Wine Bottle ===
// Bottle body - dark glass
const bottleX = 300, bottleW = 90;
const bottleGrad = ctx.createLinearGradient(bottleX, 0, bottleX + bottleW, 0);
bottleGrad.addColorStop(0, '#0e0520');
bottleGrad.addColorStop(0.3, '#1a0a30');
bottleGrad.addColorStop(0.5, '#2a1545');
bottleGrad.addColorStop(0.7, '#1a0a30');
bottleGrad.addColorStop(1, '#0a0315');
ctx.fillStyle = bottleGrad;

// Body shape with slight curves
ctx.beginPath();
ctx.moveTo(bottleX, tableY);
ctx.lineTo(bottleX + 5, 280);
ctx.bezierCurveTo(bottleX + 10, 260, bottleX + 20, 240, bottleX + 30, 230);
ctx.lineTo(bottleX + 30, 120);
ctx.bezierCurveTo(bottleX + 30, 105, bottleX + 32, 95, bottleX + 35, 90);
ctx.lineTo(bottleX + 55, 90);
ctx.bezierCurveTo(bottleX + 58, 95, bottleX + 60, 105, bottleX + 60, 120);
ctx.lineTo(bottleX + 60, 230);
ctx.bezierCurveTo(bottleX + 70, 240, bottleX + 80, 260, bottleX + 85, 280);
ctx.lineTo(bottleX + bottleW, tableY);
ctx.closePath();
ctx.fill();

// Glass highlight - left edge reflection
const hlGrad = ctx.createLinearGradient(bottleX + 8, 0, bottleX + 30, 0);
hlGrad.addColorStop(0, 'rgba(80, 50, 120, 0.6)');
hlGrad.addColorStop(1, 'rgba(80, 50, 120, 0)');
ctx.fillStyle = hlGrad;
ctx.fillRect(bottleX + 8, 250, 22, 340);

// Specular highlight
ctx.fillStyle = 'rgba(180, 160, 220, 0.3)';
ctx.fillRect(bottleX + 12, 300, 6, 200);

// Label
const labelGrad = ctx.createLinearGradient(0, 380, 0, 480);
labelGrad.addColorStop(0, '#e8dcc0');
labelGrad.addColorStop(0.5, '#d4c4a0');
labelGrad.addColorStop(1, '#c0b088');
ctx.fillStyle = labelGrad;
ctx.beginPath();
ctx.moveTo(bottleX + 12, 380);
ctx.lineTo(bottleX + bottleW - 12, 380);
ctx.lineTo(bottleX + bottleW - 12, 480);
ctx.lineTo(bottleX + 12, 480);
ctx.closePath();
ctx.fill();

// Label text suggestion (dark marks)
ctx.fillStyle = '#4a3020';
ctx.fillRect(bottleX + 22, 405, 46, 3);
ctx.fillRect(bottleX + 28, 418, 34, 2);
ctx.fillRect(bottleX + 18, 440, 54, 4);
ctx.fillRect(bottleX + 25, 455, 40, 2);

// Bottle cap/cork
ctx.fillStyle = '#3a2515';
ctx.fillRect(bottleX + 37, 80, 16, 14);

// === Fruit Bowl ===
// Bowl body - ceramic/brass
const bowlCX = 620, bowlCY = 560;
const bowlGrad = ctx.createRadialGradient(bowlCX - 20, bowlCY - 20, 10, bowlCX, bowlCY, 120);
bowlGrad.addColorStop(0, '#c8a848');
bowlGrad.addColorStop(0.5, '#9a7a28');
bowlGrad.addColorStop(1, '#6a5018');
ctx.fillStyle = bowlGrad;
ctx.beginPath();
ctx.ellipse(bowlCX, bowlCY + 20, 130, 55, 0, 0, Math.PI);
ctx.fill();

// Bowl rim
ctx.strokeStyle = '#d4b858';
ctx.lineWidth = 5;
ctx.beginPath();
ctx.ellipse(bowlCX, bowlCY - 15, 135, 38, 0, 0, Math.PI * 2);
ctx.stroke();

// Bowl interior shadow
ctx.fillStyle = 'rgba(40, 25, 8, 0.4)';
ctx.beginPath();
ctx.ellipse(bowlCX, bowlCY - 10, 125, 32, 0, 0, Math.PI * 2);
ctx.fill();

// === Fruits ===
// Big red apple - front center of bowl
const apple1Grad = ctx.createRadialGradient(555, 510, 5, 565, 520, 42);
apple1Grad.addColorStop(0, '#e83040');
apple1Grad.addColorStop(0.4, '#c41e30');
apple1Grad.addColorStop(0.8, '#8a1020');
apple1Grad.addColorStop(1, '#5a0810');
ctx.fillStyle = apple1Grad;
ctx.beginPath();
ctx.arc(565, 520, 42, 0, Math.PI * 2);
ctx.fill();

// Apple highlight
ctx.fillStyle = 'rgba(255, 200, 180, 0.4)';
ctx.beginPath();
ctx.arc(552, 505, 12, 0, Math.PI * 2);
ctx.fill();

// Second apple - darker, behind
const apple2Grad = ctx.createRadialGradient(628, 498, 5, 635, 505, 35);
apple2Grad.addColorStop(0, '#d42838');
apple2Grad.addColorStop(0.5, '#a01828');
apple2Grad.addColorStop(1, '#601018');
ctx.fillStyle = apple2Grad;
ctx.beginPath();
ctx.arc(635, 505, 35, 0, Math.PI * 2);
ctx.fill();

// Green apple
const apple3Grad = ctx.createRadialGradient(690, 515, 5, 698, 522, 32);
apple3Grad.addColorStop(0, '#88c040');
apple3Grad.addColorStop(0.5, '#608a28');
apple3Grad.addColorStop(1, '#405a18');
ctx.fillStyle = apple3Grad;
ctx.beginPath();
ctx.arc(698, 522, 32, 0, Math.PI * 2);
ctx.fill();

// Grape cluster - spilling over right edge of bowl
for (let row = 0; row < 5; row++) {
  for (let col = 0; col < 4 - Math.floor(row / 2); col++) {
    const gx = 720 + col * 14 + (row % 2) * 7;
    const gy = 480 + row * 13;
    const grapeGrad = ctx.createRadialGradient(gx - 2, gy - 2, 1, gx, gy, 8);
    grapeGrad.addColorStop(0, '#8050a8');
    grapeGrad.addColorStop(0.5, '#5a3080');
    grapeGrad.addColorStop(1, '#2a1048');
    ctx.fillStyle = grapeGrad;
    ctx.beginPath();
    ctx.arc(gx, gy, 8, 0, Math.PI * 2);
    ctx.fill();
    // Grape highlight
    ctx.fillStyle = 'rgba(200, 180, 240, 0.3)';
    ctx.beginPath();
    ctx.arc(gx - 2, gy - 3, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Pear - golden, left side of bowl
const pearGrad = ctx.createRadialGradient(508, 525, 5, 515, 530, 30);
pearGrad.addColorStop(0, '#d4b840');
pearGrad.addColorStop(0.5, '#b09828');
pearGrad.addColorStop(1, '#807018');
ctx.fillStyle = pearGrad;
// Pear body (bottom)
ctx.beginPath();
ctx.arc(515, 535, 28, 0, Math.PI * 2);
ctx.fill();
// Pear neck (top)
ctx.beginPath();
ctx.arc(512, 505, 18, 0, Math.PI * 2);
ctx.fill();
// Blend
ctx.beginPath();
ctx.moveTo(497, 520);
ctx.bezierCurveTo(495, 510, 498, 500, 500, 495);
ctx.lineTo(525, 495);
ctx.bezierCurveTo(528, 500, 532, 510, 535, 520);
ctx.fill();

// Pear stem
ctx.strokeStyle = '#5a4020';
ctx.lineWidth = 2;
ctx.beginPath();
ctx.moveTo(512, 490);
ctx.bezierCurveTo(510, 480, 515, 475, 518, 470);
ctx.stroke();

// === Cast shadows ===
ctx.globalAlpha = 0.35;
// Bottle shadow
ctx.fillStyle = '#0a0505';
ctx.beginPath();
ctx.ellipse(380, tableY + 15, 55, 12, 0.4, 0, Math.PI * 2);
ctx.fill();
// Bowl shadow
ctx.beginPath();
ctx.ellipse(660, tableY + 25, 80, 14, 0.2, 0, Math.PI * 2);
ctx.fill();
ctx.globalAlpha = 1;

// === Subtle vignette ===
const vig = ctx.createRadialGradient(W/2, H/2, 300, W/2, H/2, 700);
vig.addColorStop(0, 'rgba(0,0,0,0)');
vig.addColorStop(1, 'rgba(0,0,0,0.4)');
ctx.fillStyle = vig;
ctx.fillRect(0, 0, W, H);

fs.writeFileSync('/tmp/autoart_reference.png', c.toBuffer('image/png'));
console.log('Done:', (fs.statSync('/tmp/autoart_reference.png').size / 1024).toFixed(0) + 'KB');
