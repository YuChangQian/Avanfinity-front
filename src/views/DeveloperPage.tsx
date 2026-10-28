import { useState, type FormEvent } from "react";
import { useAtomValue } from "jotai";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { BookOpen, Check, Copy, Download, KeyRound, RotateCcw, Search, Send, ShieldCheck, Terminal, Webhook } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { StableSwap } from "../components/StableSwap";
import { DataSkeleton, PageShell } from "../components/PageShell";
import {
  ApiError,
  createDeveloperKey,
  deleteDeveloperKey,
  getDeveloperKeys,
  getDeveloperWebhookDeliveries,
  getDownstreamOpenApi,
  retryDeveloperWebhook,
  testDeveloperWebhook,
  updateDeveloperKey,
  type DeveloperKey,
  type DeveloperKeyScope,
  type OpenApiDocument,
  type OpenApiHeader,
  type OpenApiMediaType,
  type OpenApiParameter,
  type OpenApiReference,
  type OpenApiRequestBody,
  type OpenApiResponse,
  type OpenApiSchema,
} from "../api";
import { sessionAtom } from "../state";
import { CdkV2DeveloperGuide } from "../components/CdkV2DeveloperGuide";
import { useFeatures } from "../features";

const scopeGroups: Array<{ label: string; hint: string; options: Array<{ value: DeveloperKeyScope; label: string }> }> = [
  {
    label: "scopeGroupRead",
    hint: "scopeGroupReadHint",
    options: [
      { value: "products:read", label: "scopeProductsRead" },
      { value: "account:read", label: "scopeAccountRead" },
      { value: "cards:read", label: "scopeCardsRead" },
      { value: "gpt:read", label: "scopeGptRead" },
      { value: "tg-direct:read", label: "读取 TG 套餐与订单" },
      { value: "cdk:read", label: "scopeCdkRead" },
      { value: "operations:read", label: "scopeOperationsRead" },
    ],
  },
  {
    label: "scopeGroupProtected",
    hint: "scopeGroupProtectedHint",
    options: [
      { value: "cards:sensitive", label: "scopeCardsSensitive" },
      { value: "cards:manage", label: "scopeCardsManage" },
      { value: "cards:open", label: "scopeCardsOpen" },
      { value: "cards:recharge", label: "scopeCardsRecharge" },
      { value: "deposits:create", label: "scopeDepositsCreate" },
      { value: "gpt:write", label: "scopeGptWrite" },
      { value: "tg-direct:write", label: "提交 TG 直充" },
      { value: "cdk:purchase", label: "scopeCdkPurchase" },
      ...(["configure", "issue", "export", "revoke"] as const).map(v => ({ value: `cdk:${v}` as DeveloperKeyScope, label: `CDK v2 ${v}` })),
    ],
  },
];

const ipRequiredScopes = new Set<DeveloperKeyScope>([
  "cdk:configure", "cdk:issue", "cdk:export", "cdk:revoke", "cards:sensitive", "cards:manage", "cards:open", "cards:recharge", "deposits:create", "gpt:write", "x-direct:write", "tg-direct:write", "cdk:purchase",
]);

const webhookStatusKeys: Record<string, string> = {
  PENDING: "webhookStatusPending",
  DELIVERING: "webhookStatusDelivering",
  DELIVERED: "webhookStatusDelivered",
  DEAD: "webhookStatusDead",
  CANCELLED: "webhookStatusCancelled",
};

function requestDeveloperRecentAuth() {
  sessionStorage.setItem("recentAuthReturnPath", "/developer");
  window.location.assign("/login");
}

function applyDeveloperMutationError(cause: unknown, fallback: string, setError: (value: string) => void) {
  if (cause instanceof ApiError && cause.errorCode === "RECENT_AUTH_REQUIRED") {
    requestDeveloperRecentAuth();
    return;
  }
  setError(cause instanceof Error ? cause.message : fallback);
}

function DeveloperWebhooks({ token, keys }: { token: string; keys: DeveloperKey[] }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [actionError, setActionError] = useState("");
  const selectedKey = keys.find((key) => key.id === selectedId) ?? keys[0];
  const keyId = selectedKey?.id;
  const deliveries = useQuery({
    queryKey: ["developer-webhook-deliveries", keyId, page],
    queryFn: () => getDeveloperWebhookDeliveries(token, keyId!, page, 20),
    enabled: keyId !== undefined,
  });
  const refresh = () => client.invalidateQueries({ queryKey: ["developer-webhook-deliveries", keyId] });
  const sendTest = useMutation({
    mutationFn: () => testDeveloperWebhook(token, keyId!),
    onSuccess: async () => { setActionError(""); await refresh(); },
    onError: (cause) => applyDeveloperMutationError(cause, t("webhookActionFailed"), setActionError),
  });
  const retryDelivery = useMutation({
    mutationFn: (deliveryId: string) => retryDeveloperWebhook(token, deliveryId),
    onSuccess: async () => { setActionError(""); await refresh(); },
    onError: (cause) => applyDeveloperMutationError(cause, t("webhookActionFailed"), setActionError),
  });
  const result = deliveries.data?.data;
  const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / (result?.pageSize ?? 20)));
  const dateFormatter = new Intl.DateTimeFormat(i18n.language.startsWith("zh") ? "zh-CN" : "en-US", {
    dateStyle: "medium", timeStyle: "short",
  });

  return <section className="developer-webhooks">
    <div className="section-title">
      <h2><Webhook />{t("webhookDeliveries")}</h2><span>HMAC-SHA256</span>
    </div>
    {keys.length === 0
      ? <div className="empty-state">{t("webhookNeedsKey")}</div>
      : <>
        <div className="developer-webhook-toolbar">
          <label>{t("webhookApiKey")}
            <select value={keyId} onChange={(event) => { setSelectedId(Number(event.target.value)); setPage(1); }}>
              {keys.map((key) => <option key={key.id} value={key.id}>{key.name} · {key.appId}</option>)}
            </select>
          </label>
          <Button type="button" onClick={() => sendTest.mutate()} disabled={!selectedKey.webhookUrl || !selectedKey.webhookSecretReady || sendTest.isPending}>
            <Send /><StableSwap state={sendTest.isPending ? "busy" : "idle"} labels={{ idle: t("sendTestWebhook"), busy: t("sending") }} />
          </Button>
        </div>
        {!selectedKey.webhookUrl && <p className="developer-webhook-note">{t("webhookConfigureFirst")}</p>}
        {actionError && <p className="admin-alert is-error" role="alert">{actionError}</p>}
        {deliveries.isError
          ? <div className="developer-webhook-state" role="alert"><span>{t("webhookDeliveriesLoadFailed")}</span><Button variant="outline" size="sm" onClick={() => void deliveries.refetch()}>{t("retry")}</Button></div>
          : deliveries.isPending
            ? <div className="developer-webhook-state loading-skeleton loading-skeleton-block" aria-label={t("loading")}>{t("loading")}</div>
            : result?.list.length === 0
              ? <div className="empty-state">{t("noWebhookDeliveries")}</div>
              : <div className="developer-delivery-list" data-testid="webhook-delivery-list">
                {result?.list.map((delivery) => <article className="developer-delivery-row" key={delivery.id}>
                  <div>
                    <strong>{delivery.eventType}</strong>
                    <code>{delivery.id}</code>
                  </div>
                  <dl>
                    <div><dt>{t("status")}</dt><dd><span className={`developer-delivery-status is-${delivery.status.toLowerCase()}`}>{t(webhookStatusKeys[delivery.status] ?? delivery.status)}</span></dd></div>
                    <div><dt>{t("webhookAttempts")}</dt><dd>{delivery.attempts}</dd></div>
                    <div><dt>{t("webhookHttpStatus")}</dt><dd>{delivery.lastHttpStatus ?? "—"}</dd></div>
                    <div><dt>{t("webhookCreatedAt")}</dt><dd>{dateFormatter.format(new Date(delivery.createdAt))}</dd></div>
                  </dl>
                  {delivery.lastError && <p className="developer-delivery-error">{delivery.lastError}</p>}
                  {delivery.status === "DEAD" && <Button type="button" size="xs" variant="outline" aria-label={t("webhookRetryDelivery", { id: delivery.id })} onClick={() => retryDelivery.mutate(delivery.id)} disabled={retryDelivery.isPending}>
                    <RotateCcw />{t("retryDelivery")}
                  </Button>}
                </article>)}
              </div>}
        {result && result.total > result.pageSize && <nav className="developer-webhook-pagination" aria-label={t("webhookPagination")}>
          <Button type="button" size="xs" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{t("previousPage")}</Button>
          <span>{t("pageOf", { page, total: totalPages })}</span>
          <Button type="button" size="xs" variant="outline" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>{t("nextPage")}</Button>
        </nav>}
      </>}
  </section>;
}

const httpMethods = ["get", "post", "put", "patch", "delete"] as const;

function resolveOpenApiRef<T>(spec: OpenApiDocument, value: T | OpenApiReference | undefined): T | undefined {
  if (!value || typeof value !== "object" || !("$ref" in value)) return value as T | undefined;
  const ref = value.$ref;
  if (!ref.startsWith("#/")) return undefined;
  return ref.slice(2).split("/").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    return (current as Record<string, unknown>)[key];
  }, spec) as T | undefined;
}

function jsonExample(media: OpenApiMediaType | undefined, schema: OpenApiSchema | undefined) {
  if (media?.example !== undefined) return media.example;
  const declared = Object.values(media?.examples ?? {}).find((example) => "value" in example);
  return declared && "value" in declared ? declared.value : schema?.example;
}

function schemaExample(
  spec: OpenApiDocument,
  input: OpenApiSchema | OpenApiReference | undefined,
  seen = new Set<string>(),
): unknown {
  if (!input) return undefined;
  if ("$ref" in input && input.$ref) {
    if (seen.has(input.$ref)) return {};
    return schemaExample(
      spec,
      resolveOpenApiRef<OpenApiSchema>(spec, input),
      new Set(seen).add(input.$ref),
    );
  }
  const schema = input as OpenApiSchema;
  if (schema.example !== undefined) return schema.example;
  if (schema.const !== undefined) return schema.const;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  const alternatives = (schema.oneOf ?? schema.anyOf) as Array<OpenApiSchema | OpenApiReference> | undefined;
  if (alternatives?.length) return schemaExample(spec, alternatives[0], seen);
  if (Array.isArray(schema.allOf)) {
    return Object.assign(
      {},
      ...schema.allOf
        .map((part) => schemaExample(spec, part as OpenApiSchema | OpenApiReference, seen))
        .filter((value) => value && typeof value === "object"),
    );
  }
  const type = Array.isArray(schema.type) ? schema.type.find((value) => value !== "null") : schema.type;
  if (type === "object" || schema.properties) {
    return Object.fromEntries(
      Object.entries((schema.properties ?? {}) as Record<string, OpenApiSchema | OpenApiReference>)
        .map(([key, value]) => [key, schemaExample(spec, value, seen)]),
    );
  }
  if (type === "array") return [schemaExample(spec, schema.items as OpenApiSchema | OpenApiReference, seen)];
  if (type === "integer" || type === "number") return 1;
  if (type === "boolean") return true;
  if (schema.format === "uuid") return "00000000-0000-4000-8000-000000000001";
  if (schema.format === "date-time") return "2026-08-07T00:00:00Z";
  if (schema.format === "email") return "developer@example.com";
  if (schema.pattern?.includes("[0-9]")) return "10.00";
  return "string";
}

function curlExample(
  spec: OpenApiDocument,
  baseUrl: string,
  path: string,
  method: string,
  parameters: OpenApiParameter[],
  media: OpenApiMediaType | undefined,
  authenticated = true,
) {
  const valueFor = (parameter: OpenApiParameter) => {
    const schema = resolveOpenApiRef<OpenApiSchema>(spec, parameter.schema);
    return schema?.format === "uuid"
      ? "00000000-0000-4000-8000-000000000001"
      : schemaExample(spec, schema) ?? "value";
  };
  let samplePath = path;
  for (const parameter of parameters.filter((item) => item.in === "path")) {
    samplePath = samplePath.replace(`{${parameter.name}}`, encodeURIComponent(String(valueFor(parameter))));
  }
  const query = parameters
    .filter((parameter) => parameter.in === "query")
    .map((parameter) => `${encodeURIComponent(parameter.name)}=${encodeURIComponent(String(valueFor(parameter)))}`)
    .join("&");
  const body = jsonExample(media, resolveOpenApiRef<OpenApiSchema>(spec, media?.schema))
    ?? schemaExample(spec, media?.schema);
  const parts = [
    "curl --fail-with-body -sS",
    `-X ${method.toUpperCase()}`,
    `'${baseUrl}${samplePath}${query ? `?${query}` : ""}'`,
  ];
  if (authenticated) parts.push(`-H 'X-App-Id: app_your_id'`, `-H 'X-App-Secret: sk_your_secret'`);
  if (parameters.some((parameter) => parameter.name.toLowerCase() === "idempotency-key")) {
    parts.push(`-H 'Idempotency-Key: stable-business-request-001'`);
  }
  if (body !== undefined) {
    const json = JSON.stringify(body).replaceAll("'", `'"'"'`);
    parts.push(`-H 'Content-Type: application/json'`, `-d '${json}'`);
  }
  return parts.join(" \\\n  ");
}

function OpenApiBrowser({ baseUrl }: { baseUrl: string }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const query = useQuery({
    queryKey: ["downstream-openapi"],
    queryFn: getDownstreamOpenApi,
    staleTime: 5 * 60_000,
  });

  if (query.isError) return <section className="openapi-browser" id="api-reference">
    <div className="developer-webhook-state" role="alert"><span>{t("openApiLoadFailed")}</span><Button variant="outline" onClick={() => void query.refetch()}>{t("retry")}</Button></div>
  </section>;
  if (!query.data) return <section className="openapi-browser" id="api-reference"><div className="developer-webhook-state loading-skeleton loading-skeleton-block" aria-label={t("loading")}>{t("loading")}</div></section>;

  const spec = {
    ...query.data,
    paths: Object.fromEntries(Object.entries(query.data.paths).filter(([path]) => !/(?:^|\/)x-(?:direct|cdk)(?:\/|$)/.test(path))),
  };
  const operations = Object.entries(spec.paths).flatMap(([path, item]) => httpMethods.flatMap((method) => {
    const operation = item[method];
    return operation ? [{ path, method, operation, pathParameters: item.parameters ?? [] }] : [];
  }));
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = operations.filter(({ path, method, operation }) => {
    if (tag && !operation.tags?.includes(tag)) return false;
    if (!normalizedSearch) return true;
    return [path, method, operation.operationId, operation.summary, operation.description, operation["x-required-scope"], ...(operation.tags ?? [])]
      .filter(Boolean).join(" ").toLowerCase().includes(normalizedSearch);
  });
  const tagOrder = [
    ...(spec.tags?.map((item) => item.name) ?? []),
    ...operations.flatMap(({ operation }) => operation.tags ?? []).filter((value, index, values) => !spec.tags?.some((item) => item.name === value) && values.indexOf(value) === index),
  ].filter((name) => operations.some(({ operation }) => operation.tags?.includes(name)));
  const webhookOperation = Object.values(spec.webhooks ?? {}).find((item) => item.post)?.post;
  const webhookHeaders = (webhookOperation?.parameters ?? [])
    .map((parameter) => resolveOpenApiRef<OpenApiParameter>(spec, parameter))
    .filter((parameter): parameter is OpenApiParameter => Boolean(parameter));
  const webhookEvent = spec.components?.schemas?.WebhookEvent;
  const webhookEventProperties = webhookEvent?.properties as Record<string, OpenApiSchema> | undefined;
  const webhookEvents = webhookEventProperties?.type?.enum?.map(String) ?? [];
  const webhookBindings = ((webhookEvent?.allOf as Array<OpenApiSchema | OpenApiReference> | undefined) ?? [])
    .flatMap((group) => {
      const resolvedGroup = resolveOpenApiRef<OpenApiSchema>(spec, group);
      return (resolvedGroup?.oneOf as Array<OpenApiSchema | OpenApiReference> | undefined) ?? [];
    })
    .flatMap((rawBranch) => {
      const branch = resolveOpenApiRef<OpenApiSchema>(spec, rawBranch);
      const properties = branch?.properties as Record<string, OpenApiSchema> | undefined;
      const typeSchema = properties?.type;
      const events = typeSchema?.enum?.map(String) ?? (typeSchema?.const ? [String(typeSchema.const)] : []);
      const data = properties?.data?.properties as Record<string, OpenApiSchema | OpenApiReference> | undefined;
      const objectSchema = resolveOpenApiRef<OpenApiSchema>(spec, data?.object);
      return events.map((event) => ({
        event,
        title: String(branch?.title ?? event),
        objectSchema,
      }));
    });
  const webhookBindingByEvent = new Map(webhookBindings.map((binding) => [binding.event, binding]));

  return <section className="openapi-browser" id="api-reference" data-testid="openapi-browser">
    <div className="openapi-browser-heading">
      <div>
        <span className="eyebrow">OPENAPI {spec.openapi}</span>
        <h2><BookOpen />{t("openApiReferenceTitle")}</h2>
        <p>{t("openApiReferenceDesc")}</p>
      </div>
      <Button asChild variant="outline"><a href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(spec, null, 2))}`} target="_blank" rel="noreferrer" download="avanfinity-openapi.json"><Download />{t("downloadRawOpenApi")}</a></Button>
    </div>
    <div className="openapi-controls">
      <label><span>{t("searchApiOperations")}</span><div><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("searchApiPlaceholder")} /></div></label>
      <label><span>{t("filterApiTag")}</span><select value={tag} onChange={(event) => setTag(event.target.value)}>
        <option value="">{t("allApiTags")}</option>
        {tagOrder.map((value) => <option value={value} key={value}>{value}</option>)}
      </select></label>
    </div>
    <p className="openapi-result-count" aria-live="polite">{t("apiOperationsFound", { count: filtered.length, total: operations.length })}</p>

    <div className="openapi-tag-groups">
      {tagOrder.map((tagName) => {
        const group = filtered.filter(({ operation }) => operation.tags?.includes(tagName));
        if (group.length === 0) return null;
        const tagInfo = spec.tags?.find((item) => item.name === tagName);
        return <section className="openapi-tag-group" key={tagName} data-api-tag={tagName}>
          <header><div><h3>{tagName}</h3>{tagInfo?.description && <p>{tagInfo.description}</p>}</div><span>{group.length}</span></header>
          <div className="openapi-operation-list">
            {group.map(({ path, method, operation, pathParameters }) => {
              const parameters = [...pathParameters, ...(operation.parameters ?? [])]
                .map((parameter) => resolveOpenApiRef<OpenApiParameter>(spec, parameter))
                .filter((parameter): parameter is OpenApiParameter => Boolean(parameter));
              const requestBody = resolveOpenApiRef<OpenApiRequestBody>(spec, operation.requestBody);
              const media = requestBody?.content?.["application/json"] ?? Object.values(requestBody?.content ?? {})[0];
              const schema = resolveOpenApiRef<OpenApiSchema>(spec, media?.schema);
              const example = jsonExample(media, schema);
              const operationBaseUrl = new URL(operation.servers?.[0]?.url ?? baseUrl, window.location.origin).href.replace(/\/$/, "");
              const requestExample = curlExample(spec, operationBaseUrl, path, method, parameters, media, operation.security?.length !== 0);
              const responses = Object.entries(operation.responses ?? {}).map(([status, response]) => [status, resolveOpenApiRef<OpenApiResponse>(spec, response)] as const);
              return <details className="openapi-operation" key={`${method}-${path}`} data-operation-id={operation.operationId}>
                <summary>
                  <span className={`openapi-method is-${method}`}>{method.toUpperCase()}</span>
                  <code>{path}</code>
                  <span className="openapi-operation-copy"><strong>{operation.summary ?? operation.operationId}</strong><small>{operation["x-required-scope"]}</small></span>
                </summary>
                <div className="openapi-operation-detail">
                  {operation.description && <p>{operation.description}</p>}
                  <div className="openapi-operation-badges">
                    <span>{t("requiredScope")}: <code>{operation["x-required-scope"]}</code></span>
                    {operation["x-ip-allowlist-required"] && <span>{t("ipAllowlistRequired")}</span>}
                    {operation["x-idempotency-required"] && <span>{t("idempotencyKeyRequired")}</span>}
                    <span><code>{operation.operationId}</code></span>
                  </div>
                  <section>
                    <h4>{t("apiParameters")}</h4>
                    {parameters.length === 0
                      ? <p className="openapi-empty-detail">{t("noApiParameters")}</p>
                      : <div className="openapi-table-wrap"><table><thead><tr><th>{t("apiParameterName")}</th><th>{t("apiParameterLocation")}</th><th>{t("apiParameterRule")}</th><th>{t("description")}</th></tr></thead><tbody>
                        {parameters.map((parameter) => <tr key={`${parameter.in}-${parameter.name}`}><td><code>{parameter.name}</code></td><td>{parameter.in}</td><td><span>{parameter.required ? t("required") : t("optional")}</span><code>{JSON.stringify(resolveOpenApiRef<OpenApiSchema>(spec, parameter.schema) ?? {})}</code></td><td>{parameter.description ?? "—"}</td></tr>)}
                      </tbody></table></div>}
                  </section>
                  {requestBody && <section>
                    <h4>{t("apiRequestBody")} {requestBody.required && <span>{t("required")}</span>}</h4>
                    <div className="openapi-json-grid">
                      <div><strong>{t("apiJsonSchema")}</strong><pre><code>{JSON.stringify(schema ?? media?.schema ?? {}, null, 2)}</code></pre></div>
                      <div><strong>{t("apiJsonExample")}</strong>{example === undefined ? <p className="openapi-empty-detail">{t("noApiExample")}</p> : <pre><code>{JSON.stringify(example, null, 2)}</code></pre>}</div>
                    </div>
                  </section>}
                  <section data-operation-example={operation.operationId}>
                    <h4>{t("apiExamples")} · curl</h4>
                    <div className="openapi-code-example"><pre><code>{requestExample}</code></pre></div>
                  </section>
                  <section>
                    <h4>{t("apiResponses")}</h4>
                    <div className="openapi-response-grid">
                      {responses.map(([status, response]) => {
                        const responseMedia = response?.content?.["application/json"] ?? Object.values(response?.content ?? {})[0];
                        const responseSchema = resolveOpenApiRef<OpenApiSchema>(spec, responseMedia?.schema);
                        const responseExample = jsonExample(responseMedia, responseSchema)
                          ?? schemaExample(spec, responseMedia?.schema);
                        const responseHeaders = Object.entries(response?.headers ?? {}).map(([name, value]) => [
                          name,
                          resolveOpenApiRef<OpenApiHeader>(spec, value),
                        ] as const);
                        return <details className={`openapi-response-contract ${status.startsWith("2") ? "is-success" : "is-error"}`} key={status} open={status.startsWith("2")}>
                          <summary><code>{status}</code><span>{response?.description ?? t("noResponseDescription")}</span></summary>
                          {responseHeaders.length > 0 && <dl className="openapi-response-headers">
                            {responseHeaders.map(([name, header]) => <div key={name}><dt><code>{name}</code></dt><dd>{header?.description ?? "—"}<code>{JSON.stringify(resolveOpenApiRef<OpenApiSchema>(spec, header?.schema) ?? {})}</code></dd></div>)}
                          </dl>}
                          {responseMedia && <div className="openapi-json-grid">
                            <div><strong>{t("apiJsonSchema")}</strong><pre><code>{JSON.stringify(responseSchema ?? responseMedia.schema ?? {}, null, 2)}</code></pre></div>
                            <div><strong>{t("apiJsonExample")}</strong><pre><code>{JSON.stringify(responseExample, null, 2)}</code></pre></div>
                          </div>}
                        </details>;
                      })}
                    </div>
                  </section>
                </div>
              </details>;
            })}
          </div>
        </section>;
      })}
      {filtered.length === 0 && <div className="empty-state">{t("noApiOperations")}</div>}
    </div>

    <section className="openapi-webhook-reference">
      <header><div><h3><Webhook />{t("webhookEventCatalog")}</h3><p>{webhookOperation?.description}</p></div><span>{webhookEvents.length}</span></header>
      <div className="openapi-webhook-columns">
        <div><h4>{t("webhookSigningHeaders")}</h4>{webhookHeaders.map((parameter) => <article key={parameter.name}><code>{parameter.name}</code><p>{parameter.description}</p></article>)}</div>
        <div><h4>{t("webhookEventTypes")}</h4><div className="openapi-event-contracts">{webhookEvents.map((event) => {
          const binding = webhookBindingByEvent.get(event);
          const eventExample = {
            id: "evt_00000000_00004000_80000000_00000001",
            type: event,
            apiVersion: String(webhookEventProperties?.apiVersion?.const ?? spec.info.version ?? "v1"),
            createdAt: "2026-08-07T00:00:00Z",
            data: { object: schemaExample(spec, binding?.objectSchema) },
          };
          return <details className="openapi-webhook-event" data-webhook-event={event} key={event}>
            <summary><code>{event}</code><span>{binding?.title}</span></summary>
            <div className="openapi-json-grid">
              <div><strong>{t("apiJsonSchema")}</strong><pre><code>{JSON.stringify(binding?.objectSchema ?? {}, null, 2)}</code></pre></div>
              <div><strong>{t("apiJsonExample")}</strong><pre><code>{JSON.stringify(eventExample, null, 2)}</code></pre></div>
            </div>
          </details>;
        })}</div></div>
      </div>
      <p className="developer-callout">{t("apiWebhookRetry")}</p>
    </section>
  </section>;
}

export function DeveloperPage() {
  const session = useAtomValue(sessionAtom);
  const { t } = useTranslation();
  const client = useQueryClient();
  const { flags } = useFeatures();
  const [secrets, setSecrets] = useState<{ appSecret?: string; webhookSecret: string } | null>(null);
  const [copiedSecret, setCopiedSecret] = useState<"app" | "webhook" | null>(null);
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["developer-keys"],
    queryFn: () => getDeveloperKeys(session!.token),
    enabled: Boolean(session),
  });
  const mutation = useMutation({
    mutationFn: () => createDeveloperKey(session!.token, "Web API"),
    onSuccess: async (result) => {
      setError("");
      setCopiedSecret(null);
      setSecrets({ appSecret: result.data.appSecret, webhookSecret: result.data.webhookSecret });
      await client.invalidateQueries({ queryKey: ["developer-keys"] });
    },
    onError: (cause) => applyDeveloperMutationError(cause, t("updateFailed"), setError),
  });
  const update = useMutation({
    mutationFn: (input: {
      id: number;
      name: string;
      status: string;
      ipWhitelist: string;
      webhookUrl: string;
      scopes: DeveloperKeyScope[];
      cdkProductIds: string[];
      minuteLimit: number;
      dailyLimit: number;
      gptAutoCancelRenewal: boolean;
    }) => updateDeveloperKey(session!.token, input),
    onSuccess: async () => {
      setError("");
      await client.invalidateQueries({ queryKey: ["developer-keys"] });
    },
    onError: (cause) => applyDeveloperMutationError(cause, t("updateFailed"), setError),
  });
  const rotateWebhookSecret = useMutation({
    mutationFn: (id: number) => updateDeveloperKey(session!.token, { id, rotateWebhookSecret: true }),
    onSuccess: async (result) => {
      if (!result.data?.webhookSecret) {
        setError(t("updateFailed"));
        return;
      }
      setError("");
      setCopiedSecret(null);
      setSecrets({ webhookSecret: result.data.webhookSecret });
      await client.invalidateQueries({ queryKey: ["developer-keys"] });
    },
    onError: (cause) => applyDeveloperMutationError(cause, t("updateFailed"), setError),
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteDeveloperKey(session!.token, id),
    onSuccess: () => client.invalidateQueries({ queryKey: ["developer-keys"] }),
    onError: (cause) => applyDeveloperMutationError(cause, t("updateFailed"), setError),
  });

  if (!session) return <Navigate to="/login" />;
  if (query.isError) return <PageShell eyebrow="DEVELOPER" title={t("developerTitle")} description={t("developerDesc")} className="developer-page">
    <section className="deposit-panel query-error" role="alert">
      <strong>{t("developerKeysLoadFailed")}</strong>
      <Button variant="outline" onClick={() => void query.refetch()}>{t("retry")}</Button>
    </section>
  </PageShell>;
  if (!query.data) return <PageShell eyebrow="DEVELOPER" title={t("developerTitle")} description={t("developerDesc")} className="developer-page">
    <div aria-busy="true">
      <section className="deposit-panel developer-key-create"><div className="inline-action">{flags.developerApi && <Button disabled><KeyRound />{t("createKey")}</Button>}<Button asChild variant="outline"><a href="#api-reference">{t("apiDocumentation")}</a></Button></div></section>
      <section className="transaction-panel developer-keys">{[0, 1].map((item) => <form className="transaction-row developer-key-form" key={item}><div className="transaction-icon"><KeyRound /></div><div className="developer-key-fields"><strong><DataSkeleton /></strong><div className="developer-field-grid"><label>{t("keyName")}<input disabled /></label><label>{t("ipWhitelist")}<input disabled /></label></div><div className="developer-webhook-url"><label>{t("webhookUrl")}</label><input disabled /><small>{t("webhookUrlHint")}</small></div><div className="developer-quota-grid"><label>{t("minuteLimit")}<input disabled /></label><label>{t("dailyLimit")}<input disabled /></label></div></div><div className="developer-key-actions"><DataSkeleton /><div className="inline-action"><Button size="xs" disabled>{t("save")}</Button><Button type="button" size="xs" variant="outline" disabled>{t("delete")}</Button></div></div></form>)}</section>
      <section className="transaction-panel"><div className="section-title"><h2><Webhook />{t("webhookDeliveries")}</h2><DataSkeleton /></div>{[0, 1].map((item) => <article className="transaction-row" key={item}><div className="transaction-icon"><Send /></div><div><strong><DataSkeleton /></strong><small><DataSkeleton /></small></div><DataSkeleton /></article>)}</section>
      <section className="developer-guide"><div className="section-title"><h2><BookOpen />{t("developerGuideTitle")}</h2><span>API v1</span></div><div className="developer-guide-content"><article className="developer-guide-card developer-quickstart"><div className="developer-guide-heading"><Terminal /><div><h3>{t("developerQuickstart")}</h3><p>{t("developerQuickstartDesc")}</p></div></div><dl><div><dt>{t("apiBaseUrl")}</dt><dd><DataSkeleton /></dd></div><div><dt>{t("apiAuthentication")}</dt><dd><code>X-App-Id</code> + <code>X-App-Secret</code></dd></div><div><dt>{t("apiContentType")}</dt><dd><code>application/json</code></dd></div></dl></article></div></section>
    </div>
  </PageShell>;

  const copySecret = async (value: string, target: "app" | "webhook") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedSecret(target);
    } catch {
      setError(t("copyFailed"));
    }
  };

  const submitKey = (event: FormEvent<HTMLFormElement>, id: number) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const scopes = data.getAll("scopes") as DeveloperKeyScope[];
    const ipWhitelist = String(data.get("ipWhitelist") ?? "").trim();
    const minuteLimit = Number(data.get("minuteLimit"));
    const dailyLimit = Number(data.get("dailyLimit"));
    if (scopes.length === 0) {
      setError(t("selectScopeRequired"));
      return;
    }
    if (scopes.some((scope) => ipRequiredScopes.has(scope)) && !ipWhitelist) {
      setError(t("writeScopeAllowlistRequired"));
      return;
    }
    if (!Number.isInteger(minuteLimit) || minuteLimit < 1 || minuteLimit > 10_000
      || !Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 1_000_000
      || dailyLimit < minuteLimit) {
      setError(t("invalidApiQuota"));
      return;
    }
    setError("");
    update.mutate({
      id,
      name: String(data.get("name") ?? "").trim(),
      status: String(data.get("status") ?? "active"),
      ipWhitelist,
      webhookUrl: String(data.get("webhookUrl") ?? "").trim(),
      scopes,
      cdkProductIds: String(data.get("cdkProductIds") ?? "").split(/[\s,]+/).filter(Boolean),
      minuteLimit,
      dailyLimit,
      gptAutoCancelRenewal: data.get("gptAutoCancelRenewal") === "on",
    });
  };

  const baseUrl = `${window.location.origin}/api/v1`;
  const curlExample = `export BASE_URL='${baseUrl}'
export APP_ID='app_your_id'
export APP_SECRET='sk_your_secret'
export OPEN_IDEMPOTENCY_KEY="$(uuidgen)"
export RECHARGE_IDEMPOTENCY_KEY="$(uuidgen)"
export DEPOSIT_IDEMPOTENCY_KEY="$(uuidgen)"

curl -sS "$BASE_URL/products" \\
  -H "X-App-Id: $APP_ID" -H "X-App-Secret: $APP_SECRET"

# 从 products 的同一个产品对象复制以下字段；初始充值手续费按 INIT_AMOUNT * RECHARGE_RATE 向上取整到 4 位小数。
export PRODUCT_CODE='PRODUCT_CODE'
export OPEN_FEE='OPEN_FEE'
export OPEN_INITIAL_RECHARGE_FEE='INITIAL_RECHARGE_FEE'
export OPEN_QUOTE_VERSION='OPEN_QUOTE_VERSION'

curl -sS -X POST "$BASE_URL/cards/open" \\
  -H "X-App-Id: $APP_ID" -H "X-App-Secret: $APP_SECRET" \\
  -H "Idempotency-Key: $OPEN_IDEMPOTENCY_KEY" -H "Content-Type: application/json" \\
  -d "$(printf '{"productCode":"%s","firstName":"Ada","lastName":"Lovelace","initAmount":"10.00","count":1,"expectedOpenFee":"%s","expectedInitialRechargeFee":"%s","openQuoteVersion":"%s"}' "$PRODUCT_CODE" "$OPEN_FEE" "$OPEN_INITIAL_RECHARGE_FEE" "$OPEN_QUOTE_VERSION")"

curl -sS -X POST "$BASE_URL/cards/CARD_ID/recharge-quote" \\
  -H "X-App-Id: $APP_ID" -H "X-App-Secret: $APP_SECRET" -H "Content-Type: application/json" \\
  -d '{"amount":"10.00"}'

# 从 recharge-quote 响应复制 data.fee；报价变化时重新报价并使用新的 Idempotency-Key。
export RECHARGE_FEE='RECHARGE_FEE'

curl -sS -X POST "$BASE_URL/cards/CARD_ID/recharge" \\
  -H "X-App-Id: $APP_ID" -H "X-App-Secret: $APP_SECRET" \\
  -H "Idempotency-Key: $RECHARGE_IDEMPOTENCY_KEY" -H "Content-Type: application/json" \\
  -d "$(printf '{"amount":"10.00","expectedFee":"%s"}' "$RECHARGE_FEE")"

curl -sS -X POST "$BASE_URL/deposits" \\
  -H "X-App-Id: $APP_ID" -H "X-App-Secret: $APP_SECRET" \\
  -H "Idempotency-Key: $DEPOSIT_IDEMPOTENCY_KEY" -H "Content-Type: application/json" \\
  -d '{"currency":"USDT","network":"TRON","amount":"10.00"}'

curl -sS "$BASE_URL/deposits/DEPOSIT_GATEWAY_REF" \\
  -H "X-App-Id: $APP_ID" -H "X-App-Secret: $APP_SECRET"

curl -sS "$BASE_URL/operations/OPERATION_ID" \\
  -H "X-App-Id: $APP_ID" -H "X-App-Secret: $APP_SECRET"`;
  const typescriptExample = `const baseUrl = "${baseUrl}";
const auth = {
  "X-App-Id": process.env.AVANFINITY_APP_ID!,
  "X-App-Secret": process.env.AVANFINITY_APP_SECRET!,
};

async function call(path: string, init: RequestInit = {}) {
  const response = await fetch(baseUrl + path, {
    ...init,
    headers: { ...auth, "Content-Type": "application/json", ...init.headers },
  });
  const body = await response.json();
  if (!response.ok && response.status !== 202) throw new Error(body.error);
  return { status: response.status, body };
}

const products = await call("/products");
const product = products.body.data[0];
const amount = "10.00";
const [amountWhole, amountFraction = ""] = amount.split(".");
const amountUnits = BigInt(amountWhole) * 10_000n + BigInt(amountFraction.padEnd(4, "0"));
const [rateWhole, rateFraction = ""] = product.rechargeRate.split(".");
const rateUnits = BigInt(rateWhole) * 1_000_000n + BigInt(rateFraction.padEnd(6, "0"));
const initialFeeUnits = (amountUnits * rateUnits + 999_999n) / 1_000_000n;
const expectedInitialRechargeFee = String(initialFeeUnits / 10_000n) + "." + String(initialFeeUnits % 10_000n).padStart(4, "0");
const opened = await call("/cards/open", {
  method: "POST",
  headers: { "Idempotency-Key": crypto.randomUUID() },
  body: JSON.stringify({ productCode: product.productCode, firstName: "Ada", lastName: "Lovelace", initAmount: amount, count: 1, expectedOpenFee: product.openFee, expectedInitialRechargeFee, openQuoteVersion: product.openQuoteVersion }),
});
const cardId = opened.body.data.cardIds[0];
const quote = await call("/cards/" + cardId + "/recharge-quote", {
  method: "POST",
  body: JSON.stringify({ amount: "10.00" }),
});
const recharged = await call("/cards/" + cardId + "/recharge", {
  method: "POST",
  headers: { "Idempotency-Key": crypto.randomUUID() },
  body: JSON.stringify({ amount: "10.00", expectedFee: quote.body.data.fee }),
});
const operationId = opened.body.data?.operationId ?? opened.body.operationId;
const deposit = await call("/deposits", {
  method: "POST",
  headers: { "Idempotency-Key": crypto.randomUUID() },
  body: JSON.stringify({ currency: "USDT", network: "TRON", amount: "10.00" }),
});
const depositStatus = await call("/deposits/" + deposit.body.data.gatewayRef);
const operation = await call("/operations/" + operationId);`;

  return <PageShell eyebrow="DEVELOPER" title={t("developerTitle")} description={t("developerDesc")} className="developer-page">
    <section className="deposit-panel developer-key-create">
      <div className="inline-action">
        {flags.developerApi && <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || query.data.data.length >= 5}>
          <KeyRound />{t("createKey")}
        </Button>}
        <Button asChild variant="outline"><a href="#api-reference">{t("apiDocumentation")}</a></Button>
      </div>
      {secrets && <div className="developer-secret-reveal" role="status">
        <p>{t("secretOnce")}</p>
        {secrets.appSecret && <div>
          <span>{t("appSecretLabel")}</span>
          <code data-testid="new-api-secret">{secrets.appSecret}</code>
          <Button type="button" size="xs" variant="outline" onClick={() => copySecret(secrets.appSecret!, "app")}>
            {copiedSecret === "app" ? <Check /> : <Copy />}{t("copyAppSecret")}
          </Button>
        </div>}
        <div>
          <span>{t("webhookSecretLabel")}</span>
          <code data-testid="new-webhook-secret">{secrets.webhookSecret}</code>
          <Button type="button" size="xs" variant="outline" onClick={() => copySecret(secrets.webhookSecret, "webhook")}>
            {copiedSecret === "webhook" ? <Check /> : <Copy />}{t("copyWebhookSecret")}
          </Button>
        </div>
      </div>}
    </section>
    {error && <p className="admin-alert is-error" role="alert">{error}</p>}
    <section className="transaction-panel developer-keys">
      {query.data.data.length === 0
        ? <div className="empty-state">{t("noKeys")}</div>
        : query.data.data.map((key) => <form className="transaction-row developer-key-form" key={key.id} onSubmit={(event) => submitKey(event, key.id)}>
          <div className="transaction-icon"><KeyRound /></div>
          <div className="developer-key-fields">
            <strong>{key.appId} · {key.appSecretMasked}</strong>
            <div className="developer-field-grid">
              <label>{t("keyName")}<input name="name" defaultValue={key.name} required /></label>
              <label>{t("ipWhitelist")}<input name="ipWhitelist" defaultValue={key.ipWhitelist} placeholder="203.0.113.10/32" /></label>
            </div>
            <div className="developer-webhook-url">
              <label htmlFor={`developer-webhook-url-${key.id}`}>{t("webhookUrl")}</label>
              <input id={`developer-webhook-url-${key.id}`} name="webhookUrl" type="url" defaultValue={key.webhookUrl} placeholder="https://hooks.example.com:443/avanfinity" />
              <small>{t("webhookUrlHint")}</small>
              {key.webhookSecretReady === false && <small className="developer-webhook-secret-warning">{t("webhookSecretRotationRequired")}</small>}
            </div>
            <div className="developer-webhook-url">
              <label><input type="checkbox" name="gptAutoCancelRenewal" defaultChecked={key.gptAutoCancelRenewal !== false} />{t("gptKeyAutoCancelRenewal")}</label>
              <small>{t("gptKeyAutoCancelRenewalHint")}</small>
            </div>
            <fieldset className="developer-scope-fieldset">
              <legend>{t("apiScopes")}</legend>
              <label>CDK v2 显式产品授权（逗号分隔）<input name="cdkProductIds" defaultValue={(key.cdkProductIds ?? []).join(',')} placeholder="gpt.plus,x.premium_3m,tg.premium_3m" /></label>
              <p>权限预设仅修改 CDK scope；产品须明确填写，旧权限不会自动升级。写权限须 IP 白名单。</p>
              {([['只读', ['cdk:read']], ['发行', ['cdk:read','cdk:configure','cdk:issue']], ['完整管理', ['cdk:read','cdk:configure','cdk:issue','cdk:export','cdk:revoke']]] as const).map(([label, selected]) => <button key={label} type="button" onClick={event => { const form = event.currentTarget.closest('form'); form?.querySelectorAll<HTMLInputElement>('input[name="scopes"]').forEach(input => { if (input.value.startsWith('cdk:') && input.value !== 'cdk:purchase') input.checked = (selected as readonly string[]).includes(input.value); }); }}>{label}</button>)}
              <div className="developer-scope-groups">
                {scopeGroups.map((group) => <section className="developer-scope-group" key={group.label}>
                  <header><strong>{t(group.label)}</strong><small>{t(group.hint)}</small></header>
                  <div className="developer-scopes">
                    {group.options.map((scope) => <label key={scope.value}>
                      <input name="scopes" type="checkbox" value={scope.value} aria-label={t(scope.label)} defaultChecked={key.scopes.includes(scope.value)} />
                      <span>{t(scope.label)}</span><code>{scope.value}</code>
                    </label>)}
                  </div>
                </section>)}
              </div>
              <small>{t("developerKeyPolicyHint")}</small>
            </fieldset>
            <div className="developer-quota-grid">
              <label>{t("minuteLimit")}<input name="minuteLimit" type="number" min="1" max="10000" step="1" defaultValue={key.minuteLimit} required /></label>
              <label>{t("dailyLimit")}<input name="dailyLimit" type="number" min="1" max="1000000" step="1" defaultValue={key.dailyLimit} required /></label>
            </div>
          </div>
          <div className="developer-key-actions">
            <select name="status" defaultValue={key.status} aria-label={t("status")}>
              <option value="active">{t("active")}</option><option value="disabled">{t("disabled")}</option>
            </select>
            <div className="inline-action">
              <Button size="xs" disabled={update.isPending}>{t("save")}</Button>
              <Button type="button" size="xs" variant="outline" onClick={() => {
                if (window.confirm(t("rotateWebhookSecretConfirm"))) rotateWebhookSecret.mutate(key.id);
              }} disabled={rotateWebhookSecret.isPending}><RotateCcw />{t("rotateWebhookSecret")}</Button>
              <Button type="button" size="xs" variant="outline" onClick={() => remove.mutate(key.id)} disabled={remove.isPending}>{t("delete")}</Button>
            </div>
          </div>
        </form>)}
    </section>
    <DeveloperWebhooks token={session.token} keys={query.data.data} />
    <section className="developer-guide">
      <div className="section-title"><h2><BookOpen />{t("developerGuideTitle")}</h2><span>API v1</span></div>
      <div className="developer-guide-content">
        <article className="developer-guide-card developer-quickstart">
          <div className="developer-guide-heading"><Terminal /><div><h3>{t("developerQuickstart")}</h3><p>{t("developerQuickstartDesc")}</p></div></div>
          <dl>
            <div><dt>{t("apiBaseUrl")}</dt><dd><code>{baseUrl}</code></dd></div>
            <div><dt>{t("apiAuthentication")}</dt><dd><code>X-App-Id</code> + <code>X-App-Secret</code></dd></div>
            <div><dt>{t("apiContentType")}</dt><dd><code>application/json</code></dd></div>
          </dl>
          <CdkV2DeveloperGuide />
          <p className="developer-callout">{t("apiScopeIpRule")}</p>
        </article>

        <article className="developer-guide-card">
          <h3>{t("apiMoneyAndBilling")}</h3>
          <ul>
            <li>{t("apiMoneyStringRule")}</li>
            <li>{t("apiOpenBillingRule")}</li>
            <li>{t("apiRechargeBillingRule")}</li>
            <li>{t("apiPricingRule")}</li>
            <li><code>POST /deposits</code> · {t("scopeDepositsCreate")}</li>
          </ul>
        </article>

        <article className="developer-guide-card developer-retry-card">
          <h3>{t("apiIdempotencyTitle")}</h3>
          <p>{t("apiIdempotencyDesc")}</p>
          <div className="developer-table-wrap"><table>
            <thead><tr><th>{t("apiResult")}</th><th>{t("apiClientAction")}</th></tr></thead>
            <tbody>
              <tr><td><code>200</code></td><td>{t("apiRetry200")}</td></tr>
              <tr><td><code>202</code></td><td>{t("apiRetry202")}</td></tr>
              <tr><td><code>409</code></td><td>{t("apiRetry409")}</td></tr>
              <tr><td><code>429</code></td><td>{t("apiRetry429")}</td></tr>
              <tr><td><code>5xx / network</code></td><td>{t("apiRetry5xx")}</td></tr>
            </tbody>
          </table></div>
        </article>

        <article className="developer-guide-card developer-webhook-guide">
          <div className="developer-guide-heading"><Webhook /><div><h3>{t("apiWebhookTitle")}</h3><p>{t("apiWebhookIntro")}</p></div></div>
          <ul>
            <li>{t("apiWebhookSignature")}</li>
            <li>{t("apiWebhookIdempotency")}</li>
            <li>{t("apiWebhookRetry")}</li>
            <li>{t("apiWebhookOrdering")}</li>
          </ul>
          <Button asChild size="sm" variant="outline"><a href="#api-reference">{t("apiDocumentation")}</a></Button>
        </article>

        <article className="developer-guide-card developer-examples">
          <h3>{t("apiExamples")}</h3>
          <details><summary>curl</summary><pre><code>{curlExample}</code></pre></details>
          <details><summary>TypeScript · fetch</summary><pre><code>{typescriptExample}</code></pre></details>
        </article>

        <article className="developer-guide-card developer-security-card">
          <div className="developer-guide-heading"><ShieldCheck /><div><h3>{t("apiSecurityChecklist")}</h3><p>{t("apiSecurityIntro")}</p></div></div>
          <ul>
            <li>{t("apiSecurityServerOnly")}</li>
            <li>{t("apiSecurityLeastPrivilege")}</li>
            <li>{t("apiSecurityAllowlist")}</li>
            <li>{t("apiSecurityKeyLifecycle")}</li>
            <li>{t("apiSecurityLogs")}</li>
          </ul>
        </article>
      </div>
    </section>
    <OpenApiBrowser baseUrl={baseUrl} />
  </PageShell>;
}
