// Bounded subprocess helpers for native Node integration tests, not app startup.
import { stripVTControlCharacters } from 'node:util';

export function waitForOutput(child, text, { signal, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    let output = '';
    let timer;
    const finish = error => {
      clearTimeout(timer);
      child.off('error', onError);
      child.off('close', onClose);
      child.stdout?.off('data', onData);
      child.stderr?.off('data', onData);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(output);
    };
    const diagnostic = reason => new Error(`${reason}\n${stripVTControlCharacters(output)}`);
    const onError = error => finish(error);
    const onClose = (code, exitSignal) => finish(diagnostic(`Process exited before readiness (${exitSignal ?? code}).`));
    const onAbort = () => finish(signal.reason);
    const onData = chunk => {
      // Keep diagnostics bounded; strip after joining so ANSI split across chunks works.
      output = (output + chunk.toString()).slice(-65536);
      if (stripVTControlCharacters(output).includes(text)) finish();
    };
    child.once('error', onError);
    child.once('close', onClose);
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish(diagnostic('Process readiness timed out.')), timeoutMs);
    if (signal?.aborted) onAbort();
    else if (child.exitCode !== null || child.signalCode !== null) onClose(child.exitCode, child.signalCode);
  });
}

export function stopTestProcess(child, { graceMs = 1000, killMs = 1000 } = {}) {
  const release = () => {
    child.stdout?.destroy();
    child.stderr?.destroy();
    child.unref();
  };
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    release();
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let timer;
    const finish = error => {
      clearTimeout(timer);
      child.off('close', onClose);
      child.off('error', onError);
      release();
      if (error) reject(error);
      else resolve();
    };
    const onClose = () => finish();
    const onError = error => finish(error);
    child.once('close', onClose);
    child.once('error', onError);
    // Deadlines for cleanup, not sleeps waiting for test state.
    timer = setTimeout(() => {
      child.kill('SIGKILL');
      timer = setTimeout(() => finish(new Error('Test process did not stop after SIGKILL.')), killMs);
    }, graceMs);
    child.kill('SIGTERM');
  });
}
