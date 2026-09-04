/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output is for the CONTAINER build only.
  //
  // It makes the build emit its own server plus just the node_modules it needs,
  // which is what web/Dockerfile copies. Vercel builds its own function bundle
  // and does not want this, so it is gated on an env var the Dockerfile sets
  // rather than turned on unconditionally — a single next.config that is wrong
  // for one of two deploy targets is a trap for whoever tries the other one.
  ...(process.env.BUILD_TARGET === 'container' ? { output: 'standalone' } : {}),
  // onnxruntime-node ships a native .node binary; it must stay external to the
  // server bundle or the build tries to parse it as JavaScript.
  serverExternalPackages: ['onnxruntime-node'],
  // The champion artifact lives INSIDE the app root, not in ../ml/artifacts.
  // Vercel deploys `web/` as the project root and file tracing refuses globs that
  // navigate above it, so promotion copies the artifact here rather than pointing
  // at the training output directory. ml/scripts/promote_model.py does the copy.
  outputFileTracingIncludes: {
    '/api/rank': ['./model/**'],
    // /api/health loads the same ONNX session, because a readiness probe that
    // only proves the process is listening is not readiness. It traced correctly
    // without being listed here, but that is the tracer being clever rather than
    // a guarantee -- and a probe that silently loses its model reports the app
    // permanently unhealthy on one deploy target and fine on the other.
    '/api/health': ['./model/**'],
  },
  // Next 16 writes its own AGENTS.md/CLAUDE.md into the app root on dev start.
  // This repo's agent instructions live in the project root and are hand-written;
  // a generated file next to them is noise at best and contradicts them at worst.
  agentRules: false,
};
export default nextConfig;
