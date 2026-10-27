import { expect, test } from '@playwright/test';
import { api, createUser, signedInContext } from './helpers';

/** Two people with an accepted chat. */
async function friends() {
  const a = await createUser('va', 'Caller Person');
  const b = await createUser('vb', 'Callee Person');
  const chat = (await api('POST', `/messages/with/${b.id}`, a.token)).json.data.id;
  await api('POST', `/messages/${chat}`, a.token, { body: 'hello' });
  await api('POST', `/messages/${chat}/accept`, b.token);
  return { a, b, chat };
}

test.describe('Voice and video calls', () => {
  test('a video call rings, connects with real media both ways, shows a timer, and leaves a card in the chat', async ({ browser }) => {
    const { a, b, chat } = await friends();
    const A = await signedInContext(browser, a);
    const B = await signedInContext(browser, b);
    await B.page.goto('/');
    await A.page.goto(`/messages/${chat}`);
    await A.page.getByRole('button', { name: 'Start a video call' }).click();
    await expect(A.page.getByRole('dialog', { name: /Video call with/ })).toBeVisible();
    await expect(A.page.getByLabel('Call status')).toHaveText('Calling…');

    await expect(B.page.getByRole('alertdialog', { name: 'Incoming call' })).toContainText('Caller Person', { timeout: 10_000 });
    await B.page.getByRole('button', { name: 'Accept call' }).click();

    for (const p of [A.page, B.page]) {
      await expect(p.getByLabel('Call status')).toHaveText(/^\d+:\d\d$/, { timeout: 20_000 }); // connected: the timer runs
      await expect(p.getByLabel('Their video')).toHaveAttribute('data-remote-tracks', '2'); // their audio and video arrived
      await expect.poll(() => p.getByLabel('Their video').evaluate((v) => v.videoWidth)).toBeGreaterThan(0); // and is really playing
    }
    await A.page.getByRole('button', { name: 'Mute microphone' }).click();
    await expect(A.page.getByRole('button', { name: 'Unmute microphone' })).toBeVisible();
    await A.page.getByRole('button', { name: 'Turn camera off' }).click();
    await expect(A.page.getByRole('button', { name: 'Turn camera on' })).toBeVisible();

    await B.page.getByRole('button', { name: 'End call' }).click();
    await expect(B.page.getByRole('dialog')).toHaveCount(0);
    await expect(A.page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 }); // the other side hangs up too
    await expect(A.page.locator('.call-card')).toContainText(/Video call · \d+:\d\d/, { timeout: 10_000 });
    await A.ctx.close();
    await B.ctx.close();
  });

  test('a voice call carries audio only, and a declined call leaves a "Declined" card', async ({ browser }) => {
    const { a, b, chat } = await friends();
    const A = await signedInContext(browser, a);
    const B = await signedInContext(browser, b);
    await B.page.goto('/');
    await A.page.goto(`/messages/${chat}`);
    await A.page.getByRole('button', { name: 'Start a voice call' }).click();
    await B.page.getByRole('button', { name: 'Accept call' }).click({ timeout: 10_000 });
    await expect(A.page.getByLabel('Call status')).toHaveText(/^\d+:\d\d$/, { timeout: 20_000 });
    await expect(A.page.getByLabel('Their video')).toHaveAttribute('data-remote-tracks', '1');
    await expect(A.page.getByRole('button', { name: 'Turn camera off' })).toHaveCount(0); // no camera on a voice call
    await A.page.getByRole('button', { name: 'End call' }).click();
    await expect(B.page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });

    await A.page.getByRole('button', { name: 'Start a voice call' }).click();
    await B.page.getByRole('button', { name: 'Decline call' }).click({ timeout: 10_000 });
    await expect(A.page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });
    await expect(A.page.locator('.call-toast')).toHaveText('Call declined.');
    await expect(A.page.locator('.call-card').last()).toContainText('Declined voice call', { timeout: 10_000 });
    await A.ctx.close();
    await B.ctx.close();
  });

  test('cancelling before an answer stops the ringing, and calls are unavailable until a message request is accepted', async ({ browser }) => {
    const { a, b, chat } = await friends();
    const A = await signedInContext(browser, a);
    const B = await signedInContext(browser, b);
    await B.page.goto('/');
    await A.page.goto(`/messages/${chat}`);
    await A.page.getByRole('button', { name: 'Start a voice call' }).click();
    await expect(B.page.getByRole('alertdialog', { name: 'Incoming call' })).toBeVisible({ timeout: 10_000 });
    await A.page.getByRole('button', { name: 'End call' }).click();
    await expect(B.page.getByRole('alertdialog')).toHaveCount(0, { timeout: 10_000 });
    await expect(A.page.locator('.call-card').last()).toContainText('Cancelled voice call', { timeout: 10_000 });

    const c = await createUser('vc');
    const pending = (await api('POST', `/messages/with/${c.id}`, a.token)).json.data.id;
    await A.page.goto(`/messages/${pending}`);
    await expect(A.page.getByRole('button', { name: 'Start a voice call' })).toBeDisabled();
    await expect(A.page.getByRole('button', { name: 'Start a video call' })).toBeDisabled();
    await A.ctx.close();
    await B.ctx.close();
  });
});
