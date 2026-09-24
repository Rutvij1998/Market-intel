/**
 * Ask scripts/pdf_convert.py (Playwright for Python) to print a PDF.
 * stdin is the job JSON. stdout is the PDF. The Node side does not use PDFKit.
 */

import { spawn } from 'child_process';
import path from 'path';

export function renderPdfViaPlaywright(payload: unknown, timeoutMs = 120_000): Promise<Buffer> {
  const scriptPath = path.join(process.cwd(), 'scripts', 'pdf_convert.py');

  return new Promise((resolve, reject) => {
    const child = spawn('python3', [scriptPath], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Playwright PDF timed out'));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => out.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => err.push(Buffer.from(chunk)));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const stderr = Buffer.concat(err).toString().trim();
      if (code !== 0) {
        reject(new Error(stderr || `Playwright PDF exited ${code}`));
        return;
      }
      const pdf = Buffer.concat(out);
      if (pdf.length < 5 || pdf.subarray(0, 4).toString() !== '%PDF') {
        reject(new Error(stderr || 'Playwright PDF did not return a PDF'));
        return;
      }
      resolve(pdf);
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}
