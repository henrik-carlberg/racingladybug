'use client';
import { useEffect, useState } from 'react';

const b64 = (s: string) => { const p = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(p), (c) => c.charCodeAt(0)); };

/** Slå på eller av pushnotiser på den här enheten */
export function PushSettings({ publicKey, devices }: { publicKey: string; devices: number }) {
  const [state, setState] = useState<'checking' | 'unsupported' | 'denied' | 'off' | 'on' | 'busy'>('checking');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return setState('unsupported');
      if (Notification.permission === 'denied') return setState('denied');
      const reg = await navigator.serviceWorker.getRegistration();
      setState((await reg?.pushManager.getSubscription()) ? 'on' : 'off');
    })().catch(() => setState('unsupported'));
  }, []);
  const turnOn = async () => {
    setState('busy'); setMsg('');
    try {
      if ((await Notification.requestPermission()) !== 'granted') { setState('denied'); return; }
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(publicKey) });
      const r = await fetch('/api/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub.toJSON()) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Kunde inte spara');
      setState('on'); setMsg('Notiser är påslagna på den här enheten.');
    } catch (e) { setState('off'); setMsg(e instanceof Error ? e.message : 'Något gick fel'); }
  };
  const turnOff = async () => {
    setState('busy');
    const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
    if (sub) { await fetch('/api/push', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); }
    setState('off'); setMsg('Notiser är avstängda på den här enheten.');
  };
  return (
    <div className="stack" style={{ gap: '.5rem' }}>
      <div className="row" style={{ alignItems: 'center' }}>
        {state === 'on' && <><span className="badge ok">På för den här enheten</span><button type="button" className="secondary" onClick={turnOff}>Stäng av</button></>}
        {(state === 'off' || state === 'busy') && <button type="button" onClick={turnOn} disabled={state === 'busy'}>Slå på notiser på den här enheten</button>}
        {state === 'denied' && <span className="small">Notiser är blockerade i webbläsaren. Tillåt dem i webbläsarens inställningar för den här sidan.</span>}
        {state === 'unsupported' && <span className="small muted">Webbläsaren kan inte ta emot notiser. På iPhone: lägg först till appen på hemskärmen (Dela → Lägg till på hemskärmen).</span>}
        <span className="small muted">{devices} {devices === 1 ? 'enhet' : 'enheter'} tar emot notiser.</span>
      </div>
      {msg && <div className="small" role="status">{msg}</div>}
    </div>
  );
}
