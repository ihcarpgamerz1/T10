import handleRequest from '../lib/vercel-handler.js';

export default function state(request) {
  return handleRequest(request);
}
