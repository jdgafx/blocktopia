"""Verify the editable NPCs in the actual free Blockbench web editor (Python Playwright)."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[2]
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width':1280,'height':900})
    page.goto('https://web.blockbench.net/', wait_until='networkidle')
    receipts = []
    for path in sorted((ROOT / 'public/models/characters').glob('*.bbmodel')):
        result = page.evaluate('''async model => {
          Codecs.project.load(model, {path: model.name + '.bbmodel'});
          await new Promise(resolve => setTimeout(resolve, 300));
          const exported = JSON.parse(Codecs.project.compile());
          return {name: Project.name, format: Format.id, cubes: Cube.all.length,
            groups: Group.all.map(g => g.name), textures: Texture.all.length,
            textureError: Texture.all[0].error, exportedCubes: exported.elements.length};
        }''', json.loads(path.read_text()))
        assert result['cubes'] >= 39 and result['textures'] == 1 and not result['textureError'], result
        assert result['exportedCubes'] == result['cubes'], result
        assert {'head','left_arm','right_arm'} <= set(result['groups']), result
        receipts.append(result)
    page.screenshot(path='/tmp/blocktopia-blockbench-characters.png')
    browser.close()
    print(json.dumps(receipts, indent=2))
