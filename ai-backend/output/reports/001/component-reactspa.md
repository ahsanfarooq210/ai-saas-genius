## ReactSPA

### Responsibilities
- Render the user-facing single-page application (SPA) for creating, managing, and analyzing shortened URLs.
- Execute client-side routing, form validation, and interactive UI logic entirely in the browser without server-side rendering.
- Serve static JS/CSS bundles exclusively from object storage via `CDNEdge`; the ReactSPA itself never handles static asset requests in production.
- Issue all dynamic API calls to `APIGateway` using JWT bearer tokens for authenticated endpoints.
- Manage the client-side authentication lifecycle: submit credentials to `AuthService` through `APIGateway`, store received tokens, attach them to outbound requests, and tear down the session on `401`/`403` responses.

### Static Asset Architecture
- Production builds emit content-hashed, immutable JS and CSS chunks (e.g., `main.a1b2c3.js`) to object storage.
- `CDNEdge` serves these assets with `Cache-Control: public, max-age=31536000, immutable`, ensuring indefinite edge caching for the lifetime of the deployment.
- A lightweight `index.html` entry point is also cached at `CDNEdge` with a short TTL (or stale-while-revalidate) to allow new deployments to propagate without breaking in-flight chunk loading.
- No compute resources are consumed serving static content; scaling for viral landing-page traffic is absorbed entirely by `CDNEdge` PoPs.

### Dynamic API Integration
- **Target**: All `fetch`/XHR calls route to the single `APIGateway` origin. The SPA has no direct knowledge of downstream `URLService`, `AuthService`, or `RedirectEdge` topology.
- **Authentication**: A request interceptor injects `Authorization: Bearer <access_token>` on every authenticated call. Tokens are held in `sessionStorage` (or an equivalent in-memory store) to limit XSS blast radius; `localStorage` is avoided for persistent JWT storage.
- **Error Handling**:
  - `401 Unauthorized` / `403 Forbidden`: Clears client tokens and redirects to `/login`.
  - `429 Too Many Requests`: Surfaces a user-visible retry backoff aligned with `APIGateway` rate-limit windows.
  - `5xx Server Error`: Displays a degraded UI state with automatic idempotent retry (up to 3 attempts with exponential backoff).
- **State Caching**: Uses a client-side synchronization layer (e.g., React Query / SWR) to deduplicate concurrent requests and retain dashboard/analytics data across route navigations, reducing redundant `GET` traffic to `APIGateway`.

### Data Ownership
The ReactSPA is stateless from a server perspective and persists no data to disk. It transiently holds:
- **JWT access tokens**: In-memory or `sessionStorage`; lost on tab close.
- **Server-state cache**: URL lists, pagination cursors, and analytics aggregates fetched from `APIGateway`. Treated as ephemeral and refreshed on mutation.
- **UI state**: Form inputs, modal visibility, and client-side routing history. Never persisted to origin storage.

### Interfaces
- **Inbound**: None. The application is purely a consumer of APIs and does not expose endpoints.
- **Outbound (to APIGateway)**:
  - `POST /api/v1/auth/register` – Account creation.
  - `POST /api/v1/auth/login` – Session initiation; receives JWT.
  - `POST /api/v1/urls` – Create a new short URL (body: `{ longUrl, customAlias?, expiresAt? }`).
  - `GET /api/v1/urls?page=&limit=` – Paginated list of URLs owned by the authenticated user.
  - `DELETE /api/v1/urls/:shortCode` – Revoke or delete a mapping.
  - `GET /api/v1/analytics/:shortCode?from=&to=` – Retrieve click-through metrics.
- **Headers**: `Authorization`, `Content-Type: application/json`, `X-Request-ID` (client-generated UUID for distributed tracing).

### Failure Modes
| Failure | Impact | Mitigation |
|---|---|---|
| **Stale JS chunks after deployment** | Users experience runtime errors if `index.html` references deleted chunks due to non-atomic CDN purging. | Build pipeline generates immutable hashed filenames; object storage versioning ensures old chunks remain addressable until CDN TTL expires. |
| **APIGateway unreachable** | All dynamic functionality (URL creation, analytics) fails. | Client retry with exponential backoff; graceful UI degradation to cached read-only views where possible. |
| **JWT expiration without refresh** | User is abruptly logged out on next API call. | SPA treats any `401` from `APIGateway` as a hard session termination and redirects to login. |
| **Large initial bundle** | Poor Time-to-Interactive under slow networks despite `CDNEdge`. | Route-based code splitting and lazy loading for heavy views (e.g., analytics charts, settings panels). |
| **CORS misconfiguration** | Browser blocks API calls if `APIGateway` CORS policy doesn't whitelist the CDNEdge origin. | `APIGateway` must explicitly allow the static origin domain, preflight `OPTIONS`, and `Authorization` header. |
| **XSS via compromised dependency** | Malicious script access to tokens or user data. | Strict CSP headers delivered by CDNEdge, dependency vulnerability scanning, and avoiding `dangerouslySetInnerHTML` on dynamic content. |

### Scaling Considerations
- **Origin offload**: Because static assets are served from object storage through `CDNEdge`, the ReactSPA faces zero compute scaling concerns for read-heavy viral traffic. The only origin-bound load comes from authenticated API calls traversing `APIGateway`.
- **Bundle size governance**: Enforce maximum chunk size budgets in CI/CD to prevent cache misses and slow parse times on low-end devices.
- **API efficiency**: Implement cursor-based pagination for URL lists and debounced search inputs to avoid thundering-herd `GET` requests against `APIGateway` during high-interaction sessions.
- **Deployment atomicity**: Upload new build artifacts to a versioned object storage prefix and update the `CDNEdge` origin path or invalidate `index.html` to ensure all users load a consistent application version.
- **Global distribution**: `CDNEdge` PoPs naturally bring static assets closer to users globally; no regional SPA replicas are required.

## Related Diagrams
- `diagrams/001/iter4_component-reactspa.mmd`