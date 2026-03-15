import { newPage } from '../controller';
import { log } from '../logger';
import path from 'path';
import fs from 'fs';

export async function overleafRead(projectUrl: string): Promise<string> {
  try {
    const page = await newPage(projectUrl);
    await page.waitForTimeout(5000);

    // Check if we need to log in
    if (page.url().includes('/login') || page.url().includes('/register')) {
      await page.close();
      return 'Not logged in to Overleaf. Please log in to Overleaf in the browser first.';
    }

    // Wait for editor to load
    await page.waitForTimeout(3000);

    let content: string | null = null;

    // Strategy 1: CodeMirror 6
    try {
      content = await page.evaluate(() => {
        // Try window.__editorView
        if ((window as any).__editorView) {
          return (window as any).__editorView.state.doc.toString();
        }

        // Try finding CM6 instance via DOM
        const cmEditor = document.querySelector('.cm-editor') as any;
        if (cmEditor?.__cmView) {
          return cmEditor.__cmView.view.state.doc.toString();
        }

        // Try CM6 view through editor element
        const cmContent = document.querySelector('.cm-content');
        if (cmContent) {
          const view = (cmContent as any).cmView?.view;
          if (view) return view.state.doc.toString();
        }

        return null;
      });

      if (content) {
        log.info('Overleaf: read content via CodeMirror 6');
        await page.close();
        return content;
      }
    } catch (e) {
      log.debug('Overleaf CM6 strategy failed:', e);
    }

    // Strategy 2: Ace editor
    try {
      content = await page.evaluate(() => {
        if ((window as any).ace) {
          const editor = (window as any).ace.edit('editor');
          if (editor) return editor.getValue();
        }
        return null;
      });

      if (content) {
        log.info('Overleaf: read content via Ace editor');
        await page.close();
        return content;
      }
    } catch (e) {
      log.debug('Overleaf Ace strategy failed:', e);
    }

    // Strategy 3: DOM scrape
    try {
      content = await page.evaluate(() => {
        const lines = document.querySelectorAll(
          '.cm-line, .CodeMirror-line, .ace_line'
        );
        if (lines.length === 0) return null;
        return Array.from(lines)
          .map((line) => line.textContent || '')
          .join('\n');
      });

      if (content) {
        log.info('Overleaf: read content via DOM scrape');
        await page.close();
        return content;
      }
    } catch (e) {
      log.debug('Overleaf DOM scrape strategy failed:', e);
    }

    await page.close();
    return 'Could not read Overleaf editor content. The editor may not have loaded properly.';
  } catch (e: any) {
    log.error('Overleaf read error:', e.message);
    return `Error reading Overleaf: ${e.message}`;
  }
}

export async function overleafReplace(
  projectUrl: string,
  searchText: string,
  replaceText: string
): Promise<string> {
  try {
    const page = await newPage(projectUrl);
    await page.waitForTimeout(5000);

    if (page.url().includes('/login') || page.url().includes('/register')) {
      await page.close();
      return 'Not logged in to Overleaf.';
    }

    await page.waitForTimeout(3000);

    // Open Find & Replace with Ctrl+H (Cmd+H on Mac)
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+h`);
    await page.waitForTimeout(1000);

    // Find the search input and fill it
    const searchInputSelectors = [
      '.cm-search input[name="search"], .cm-search input:first-of-type',
      'input.search-input, input[placeholder*="Search"], input[placeholder*="Find"]',
      '.ol-cm-search input:first-of-type',
    ];

    let searchFilled = false;
    for (const sel of searchInputSelectors) {
      try {
        const input = page.locator(sel).first();
        if (await input.isVisible({ timeout: 2000 })) {
          await input.fill(searchText);
          searchFilled = true;
          break;
        }
      } catch (_) {}
    }

    if (!searchFilled) {
      await page.close();
      return 'Could not find the search input in Overleaf editor.';
    }

    await page.waitForTimeout(500);

    // Find the replace input and fill it
    const replaceInputSelectors = [
      '.cm-search input[name="replace"], .cm-search input:nth-of-type(2)',
      'input.replace-input, input[placeholder*="Replace"]',
      '.ol-cm-search input:nth-of-type(2)',
    ];

    let replaceFilled = false;
    for (const sel of replaceInputSelectors) {
      try {
        const input = page.locator(sel).first();
        if (await input.isVisible({ timeout: 2000 })) {
          await input.fill(replaceText);
          replaceFilled = true;
          break;
        }
      } catch (_) {}
    }

    if (!replaceFilled) {
      await page.close();
      return 'Could not find the replace input in Overleaf editor.';
    }

    await page.waitForTimeout(500);

    // Click "Replace All"
    const replaceAllSelectors = [
      'button[name="replaceAll"]',
      'button:has-text("All")',
      'button.cm-button:last-of-type',
      'button[title*="Replace all"], button[aria-label*="Replace all"]',
    ];

    let replaced = false;
    for (const sel of replaceAllSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          await btn.click();
          replaced = true;
          break;
        }
      } catch (_) {}
    }

    // Close find/replace
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    await page.close();

    if (replaced) {
      log.info(`Overleaf: replaced "${searchText}" with "${replaceText}"`);
      return `✅ Replaced all occurrences of "${searchText}" with "${replaceText}" in Overleaf.`;
    }

    return 'Find & Replace dialog opened but could not click Replace All. The replacement may not have completed.';
  } catch (e: any) {
    log.error('Overleaf replace error:', e.message);
    return `Error in Overleaf replace: ${e.message}`;
  }
}

export async function overleafCompile(projectUrl: string): Promise<string> {
  try {
    const page = await newPage(projectUrl);
    await page.waitForTimeout(5000);

    if (page.url().includes('/login') || page.url().includes('/register')) {
      await page.close();
      return 'Not logged in to Overleaf.';
    }

    await page.waitForTimeout(3000);

    // Click Recompile button
    const compileSelectors = [
      'button:has-text("Recompile")',
      'button:has-text("Compile")',
      '.btn-recompile',
      'button[aria-label="Recompile"]',
      '.toolbar-btn-recompile',
    ];

    let compiled = false;
    for (const sel of compileSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 3000 })) {
          await btn.evaluate((el: HTMLElement) => el.click());
          compiled = true;
          break;
        }
      } catch (_) {}
    }

    if (!compiled) {
      // Try keyboard shortcut
      const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
      await page.keyboard.press(`${modifier}+Enter`);
      compiled = true;
    }

    // Wait for compilation
    await page.waitForTimeout(10000);

    // Try to download the PDF
    const downloadPath = path.join(process.cwd(), 'resume.pdf');

    try {
      // Look for download button
      const downloadSelectors = [
        'a[href*="/output.pdf"]',
        'a:has-text("Download PDF")',
        'button:has-text("Download PDF")',
        '.pdf-download-button',
      ];

      for (const sel of downloadSelectors) {
        try {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 3000 })) {
            const [download] = await Promise.all([
              page.waitForEvent('download', { timeout: 15000 }),
              btn.click(),
            ]);
            await download.saveAs(downloadPath);
            log.info('Overleaf: PDF downloaded to', downloadPath);
            await page.close();
            return `✅ Compiled and downloaded PDF to resume.pdf`;
          }
        } catch (_) {}
      }

      // Fallback: try to get PDF URL from the preview iframe
      const pdfUrl = await page.evaluate(() => {
        const iframe = document.querySelector(
          'iframe.pdf-viewer, iframe[src*="output.pdf"]'
        ) as HTMLIFrameElement;
        return iframe?.src || null;
      });

      if (pdfUrl) {
        const response = await page.context().request.get(pdfUrl);
        const buffer = await response.body();
        fs.writeFileSync(downloadPath, buffer);
        log.info('Overleaf: PDF saved from iframe URL');
        await page.close();
        return `✅ Compiled and downloaded PDF to resume.pdf`;
      }
    } catch (e) {
      log.debug('Overleaf PDF download error:', e);
    }

    await page.close();

    if (compiled) {
      return '✅ Compiled successfully, but could not auto-download the PDF. You can download it manually from Overleaf.';
    }

    return 'Could not find compile button in Overleaf.';
  } catch (e: any) {
    log.error('Overleaf compile error:', e.message);
    return `Error compiling Overleaf: ${e.message}`;
  }
}
