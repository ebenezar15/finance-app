import { config, send } from './_shared.js';

/** Tells the app whether Google Drive backup is configured, and the public client ID. */
export default function handler(req, res) {
  const c = config();
  send(res, 200, { enabled: c.ready, clientId: c.ready ? c.id : null });
}
