// The app asks the desktop worker for its log by writing this file; the worker
// answers by writing Logs/<time>-worker.md and deleting the request.
export const LOG_REQUEST_PATH = 'Logs/request-worker.json';
