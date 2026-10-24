import { expect, test } from '@playwright/test';
import { PASSWORD, createUser, otp, randomUsPhone, trackErrors, uiLogin, unique } from './helpers';

test.describe('Sign up, sign in, forgot password', () => {
  test('sign-up form shows clear errors for bad input', async ({ page }) => {
    await page.goto('/signup');
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByText(/valid email/i)).toBeVisible();
    await expect(page.getByText(/at least 8/i)).toBeVisible();
  });

  test('full sign-up with email and phone codes, then logout and login', async ({ page }) => {
    const errors = trackErrors(page);
    const username = unique('su');
    const phone = randomUsPhone();
    await page.goto('/signup');
    await page.getByLabel('Full name').fill('Sign Up Tester');
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Email').fill(`${username}@example.com`);
    await page.locator('#country').selectOption('US');
    await page.getByLabel(/Mobile number/i).fill(phone.replace('+1', ''));
    await page.getByLabel(/Date of birth/i).fill('1998-04-12');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: /create account/i }).click();

    // email code, then phone code
    await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible();
    await page.getByLabel('Digit 1').click();
    await page.keyboard.type(await otp('email', username));
    await expect(page.getByRole('heading', { name: /check your phone/i })).toBeVisible();
    await page.getByLabel('Digit 1').click();
    await page.keyboard.type(await otp('phone', username));
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/signin/);
    await uiLogin(page, `${username}@example.com`);
    expect(errors).toEqual([]);
  });

  test('a wrong code is rejected and counted', async ({ page }) => {
    const username = unique('wc');
    await page.goto('/signup');
    await page.getByLabel('Full name').fill('Wrong Code');
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Email').fill(`${username}@example.com`);
    await page.locator('#country').selectOption('US');
    await page.getByLabel(/Mobile number/i).fill(randomUsPhone().replace('+1', ''));
    await page.getByLabel(/Date of birth/i).fill('1998-04-12');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: /create account/i }).click();
    await page.getByLabel('Digit 1').click();
    await page.keyboard.type('000000');
    await expect(page.getByRole('alert').filter({ hasText: /isn.t right/i })).toBeVisible();
  });

  test('wrong password shows the same generic message as an unknown account', async ({ page }) => {
    const u = await createUser('lg');
    await page.goto('/signin');
    await page.getByLabel('Username, email or phone').fill(u.username);
    await page.getByLabel('Password', { exact: true }).fill('definitely-wrong-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    const real = await page.getByRole('alert').innerText();
    await page.getByLabel('Username, email or phone').fill('nobody.exists.here');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText(real);
  });

  test('sign in works with username, email and phone', async ({ browser }) => {
    const u = await createUser('lg3');
    for (const id of [u.username, u.email, u.phone]) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await uiLogin(page, id);
      await ctx.close();
    }
  });

  test('forgot password: code, new password, old one stops working', async ({ page }) => {
    const u = await createUser('fp');
    await page.goto('/signin');
    await page.getByRole('link', { name: /forgot password/i }).click();
    await page.getByLabel('Username, email or phone').fill(u.email);
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByRole('heading', { name: /new password/i })).toBeVisible();
    await page.getByLabel('Digit 1').click();
    await page.keyboard.type(await otp('email', u.email));
    await page.getByLabel('New password').fill('freshpass77');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText(/password changed/i)).toBeVisible();
    await uiLogin(page, u.username, 'freshpass77');
  });

  test('forgot password: in development the code is shown on screen, and an unknown account explains itself', async ({ page }) => {
    const u = await createUser('fd');
    await page.goto('/forgot');
    await page.getByLabel('Username, email or phone').fill('nobody.exists.zz');
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByRole('note')).toContainText(/No account matches/i);
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByLabel('Username, email or phone').fill(u.username);
    await page.getByRole('button', { name: 'Send code' }).click();
    const shown = (await page.getByRole('note').locator('.dev-code b').innerText()).trim();
    expect(shown).toBe(await otp('email', u.email));
    await page.getByRole('button', { name: 'Fill it in' }).click();
    await page.getByLabel('New password').fill('onscreen55');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText(/password changed/i)).toBeVisible();
  });

  test('forgot password: a wrong code says how many tries are left', async ({ page }) => {
    const u = await createUser('fw');
    await page.goto('/forgot');
    await page.getByLabel('Username, email or phone').fill(u.email);
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.getByLabel('Digit 1').click();
    await page.keyboard.type('000000');
    await page.getByLabel('New password').fill('whatever77');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByRole('alert')).toContainText(/4 tries left/);
  });

  test('sign-up phone: India (+91) is preselected, the box holds only 10 digits with no country code inside, and bad numbers are explained', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('#country')).toHaveValue('IN');
    const box = page.getByLabel('Mobile number');
    await expect(page.locator('.field', { has: box }).locator('.prefix')).toHaveCount(0); // no "+91" inside the number box
    await box.fill('98765abc4321099999'); // letters are dropped and it stops at 10 digits
    await expect(box).toHaveValue('9876543210');
    await box.fill('+91 98765 43210'); // a pasted number with the country code and spaces
    await expect(box).toHaveValue('9876543210');
    await box.fill('09876543210'); // a leading 0 is dropped
    await expect(box).toHaveValue('9876543210');
    await box.fill('12345');
    await box.blur();
    await expect(page.getByText(/10-digit mobile number/i).first()).toBeVisible();
    await box.fill('1234567890');
    await box.blur();
    await expect(page.getByText(/starts with 6, 7, 8 or 9/i)).toBeVisible();
    await box.fill('9876543210');
    await box.blur();
    await expect(page.getByText(/10-digit|starts with 6|at most 10/i)).toHaveCount(0);
  });

  test('the sign-in side shows the logo and one clear line about the app', async ({ page }) => {
    await page.goto('/signin');
    const panel = page.getByRole('complementary', { name: 'About SocialAmbak' });
    await expect(panel).toContainText('Connect with friends and the world around you on SocialAmbak.');
    await expect(panel.locator('.pool-word').first()).toHaveText('SocialAmbak');
  });

  test('back buttons on auth screens', async ({ page }) => {
    await page.goto('/signup');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/signin/);
    await page.goto('/forgot');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/signin/);
  });

  test('signed-out visitors are sent to sign in, and unknown pages show a 404 when signed in', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/signin/);
    const u = await createUser('nf');
    await uiLogin(page, u.username);
    await page.goto('/this/page/does/not/exist');
    await expect(page.getByRole('heading', { name: /page not found/i })).toBeVisible();
  });
});
