import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

async function createSession(request: APIRequestContext, title?: string): Promise<string> {
  const res = await request.post('/api/sessions', { data: { title } });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { meta: { id: string } };
  return body.meta.id;
}

async function sessionMeta(request: APIRequestContext, id: string): Promise<Record<string, unknown>> {
  const res = await request.get(`/api/sessions/${id}`);
  return ((await res.json()) as { meta: Record<string, unknown> }).meta;
}

test.beforeEach(async ({ request }) => {
  const health = await request.get('/api/health');
  expect(health.ok()).toBeTruthy();
});

test('loads, lists sessions, and auto-selects the most recent', async ({ page, request }) => {
  const id = await createSession(request, 'e2e session');
  await page.goto('/');
  await expect(page.getByText('e2e session')).toBeVisible();
  // auto-selected: composer shows a model pill with the default model
  await expect(page.getByLabel('Model')).toHaveValue('fake-pro');
  // and the session row is active
  await expect(page.locator('.session-item--active')).toContainText('e2e session');
  void id;
});

test('sends a message and renders the streamed reply with usage + cache readout', async ({
  page,
  request,
}) => {
  await createSession(request);
  await page.goto('/');
  const input = page.getByPlaceholder(/Send a message/);
  await input.click();
  await input.fill('hello');
  await input.press('Enter');

  await expect(page.locator('.msg--assistant .msg__content')).toContainText('Hello from the fake provider.');
  // usage readout: last turn ↑1.2k ↓40 · cache 67%, session totals visible
  const usage = page.locator('.chat__usage');
  await expect(usage).toContainText('1.2k');
  await expect(usage).toContainText('cache 67%');
  await expect(usage).toContainText('session');
});

test('model selector offers only wallet-rated models and switches session model', async ({
  page,
  request,
}) => {
  const id = await createSession(request);
  await page.goto('/');
  const select = page.getByLabel('Model');
  // models load asynchronously; wait for the filtered list to arrive
  await expect(select.locator('option')).toHaveCount(2);
  const options = await select.locator('option').allTextContents();
  expect(options).toEqual(['fake-flash', 'fake-pro']); // unrated-fake filtered out

  await select.selectOption('fake-flash');
  await expect(select).toHaveValue('fake-flash');
  const meta = await sessionMeta(request, id);
  expect(meta.model).toBe('fake-flash');
});

test('reasoning selector drives reasoning_effort through the settings API', async ({
  page,
  request,
}) => {
  const id = await createSession(request);
  await page.goto('/');
  const select = page.getByLabel('Reasoning effort');
  await select.selectOption('high');
  let meta = await sessionMeta(request, id);
  expect(meta.reasoningEffort).toBe('high');
  await select.selectOption('max');
  meta = await sessionMeta(request, id);
  expect(meta.reasoningEffort).toBe('max');
  await select.selectOption('auto');
  meta = await sessionMeta(request, id);
  expect(meta.reasoningEffort).toBeUndefined();
});

test('settings survive a reload', async ({ page, request }) => {
  const id = await createSession(request);
  await page.goto('/');
  await page.getByLabel('Reasoning effort').selectOption('high');
  await page.reload();
  await expect(page.getByLabel('Reasoning effort')).toHaveValue('high');
  const meta = await sessionMeta(request, id);
  expect(meta.reasoningEffort).toBe('high');
});

test('switching sessions in the sidebar loads the right transcript', async ({ page, request }) => {
  const first = await createSession(request);
  await page.goto('/');
  const input = page.getByPlaceholder(/Send a message/);
  await input.click();
  await input.fill('first session message');
  await input.press('Enter');
  await expect(page.locator('.msg--assistant .msg__content').first()).toContainText('fake provider');

  const second = await createSession(request);
  await page.reload();
  await page.locator('.session-item', { hasText: 'New session' }).last().click();
  await expect(page.getByText('first session message')).toHaveCount(0);
  await expect(page.getByPlaceholder(/Send a message/)).toBeVisible();
  void first;
  void second;
});
