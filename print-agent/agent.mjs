import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '1.1.0';
const PORT = Number(process.env.PRINT_AGENT_PORT ?? 9123);
const ORIGINS = (process.env.PRINT_AGENT_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);
const MAX_BYTES = 2 * 1024 * 1024;
const RAW_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'raw-print.ps1');
const REDIRECTED = /\s*\((?:redirecionad[ao]|redirected|redirigid[ao])\s*\d*\)\s*$/i;

function baseName(name) {
  return name.replace(REDIRECTED, '').trim().toLowerCase();
}

function resolvePrinter(printers, wanted) {
  return printers.find((item) => item.name === wanted) ?? printers.find((item) => baseName(item.name) === baseName(wanted));
}

function powershell(args, timeout = 30_000) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args], { timeout, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim().split(/\r?\n/)[0]));
      else resolve(stdout);
    });
  });
}

async function listPrinters() {
  const output = await powershell([
    '-Command',
    'Get-CimInstance Win32_Printer | Select-Object Name,DriverName,PortName,Default,WorkOffline,Shared | ConvertTo-Json -Compress',
  ]);
  if (!output.trim()) return [];
  const parsed = JSON.parse(output);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((printer) => ({
    name: printer.Name,
    driver: printer.DriverName,
    port: printer.PortName,
    isDefault: Boolean(printer.Default),
    offline: Boolean(printer.WorkOffline),
    shared: Boolean(printer.Shared),
  }));
}

async function printRaw(printer, data, copies) {
  const file = join(tmpdir(), `mavie-${randomBytes(8).toString('hex')}.bin`);
  await writeFile(file, data);
  try {
    await powershell(['-File', RAW_SCRIPT, '-Printer', printer, '-Path', file, '-Copies', String(copies)], 60_000);
  } finally {
    await unlink(file).catch(() => undefined);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES * 2) {
        reject(Object.assign(new Error('Pedido demasiado grande'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('JSON invalido'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin?.replace(/\/$/, '');
  if (origin) {
    if (!ORIGINS.includes(origin)) {
      send(res, 403, { message: `Origem ${origin} nao autorizada. Acrescente-a a PRINT_AGENT_ORIGINS.` });
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.headers['access-control-request-private-network']) res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  try {
    if (req.method === 'GET' && path === '/health') {
      send(res, 200, { ok: true, version: VERSION });
      return;
    }
    if (req.method === 'GET' && path === '/printers') {
      send(res, 200, await listPrinters());
      return;
    }
    if (req.method === 'POST' && path === '/print') {
      const body = await readBody(req);
      const printer = typeof body.printer === 'string' ? body.printer : '';
      const copies = Math.min(Math.max(Number.parseInt(body.copies, 10) || 1, 1), 5);
      const data = Buffer.from(typeof body.data === 'string' ? body.data : '', 'base64');
      if (!data.length || data.length > MAX_BYTES) {
        send(res, 400, { message: 'Documento vazio ou demasiado grande' });
        return;
      }
      const found = resolvePrinter(await listPrinters(), printer);
      if (!found) {
        send(res, 404, { message: `A impressora "${printer}" nao esta instalada neste computador` });
        return;
      }
      await printRaw(found.name, data, copies);
      send(res, 200, { status: 'printed', printer: found.name });
      return;
    }
    send(res, 404, { message: 'Nao encontrado' });
  } catch (error) {
    send(res, error.status ?? 500, { message: error.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Agente de impressao MAVIE-HGest ${VERSION} em http://127.0.0.1:${PORT}`);
  console.log(`Origens autorizadas: ${ORIGINS.join(', ')}`);
});
