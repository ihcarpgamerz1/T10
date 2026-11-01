import handleRequest from '../lib/vercel-handler.js';

export default function session(request) {
  return handleRequest(request);
}
