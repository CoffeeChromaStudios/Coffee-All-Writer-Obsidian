
/* Coffee All Writer - v1.0.4 (JS sem build, refatorado) */
const { Plugin, Notice, PluginSettingTab, Setting, TFile, ItemView } = require('obsidian');
const moment = window.moment;

const VIEW_TYPE_STORYBOARD = 'caw-storyboard';

const DEFAULT_SETTINGS = {
  language: 'pt',
  showContextMenu: true,
  sessionGoals: { words: 500, timeMin: 25 },
  dailyFolder: '',
  dailyFormat: 'YYYY-MM-DD'
};

const I18N = {
  pt: {
    appName: "Coffee All Writer",
    insertTemplate: "Inserir Template",
    chooseTemplate: "Escolha um template",
    timer: "⏱",
    words: "palavras",
    minutes: "min",
    streak: "streak",
    menu: { Dialogo: "Diálogo", Parenteses: "Parêntese", Descricao: "Descrição" },
    achievements: {
      w500: "🎉 Você escreveu 500 palavras hoje!",
      w1000: "🔥 Mil palavras atingidas, continue assim!",
      streak7: "🌙 Você manteve sua streak de 7 dias, parabéns!",
      coffee: "Seu texto está crescendo como um bom café ☕"
    },
    viewName: "Storyboard (Coffee)"
  },
  en: {
    appName: "Coffee All Writer",
    insertTemplate: "Insert Template",
    chooseTemplate: "Choose a template",
    timer: "⏱",
    words: "words",
    minutes: "min",
    streak: "streak",
    menu: { Dialogo: "Dialogue", Parenteses: "Parenthetical", Descricao: "Description" },
    achievements: {
      w500: "🎉 You wrote 500 words today!",
      w1000: "🔥 One thousand words, keep going!",
      streak7: "🌙 You kept a 7-day streak, congrats!",
      coffee: "Your text is brewing like a great coffee ☕"
    },
    viewName: "Storyboard (Coffee)"
  }
};

class StoryboardView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return VIEW_TYPE_STORYBOARD; }
  getDisplayText() { return I18N[this.plugin.settings.language].viewName; }
  getIcon() { return 'gallery-vertical-end'; }
  async onOpen() { await this.render(); }
  async onClose() {}
  async render() {
    const container = this.containerEl.empty();
    const content = container.createDiv({ cls: 'caw-storyboard' });

    const file = this.app.workspace.getActiveFile();
    if (!file) { content.createEl('p', { text: 'Abra uma nota para gerar o storyboard.' }); return; }
    const text = await this.app.vault.read(file);
    const lines = text.split('\n');
    const isScene = (ln)=> /^(INT\.|EXT\.|INT\.\/EXT\.|TEASER\b|ESTABLISHING|FADE IN:|FADE OUT\.|MONTAGE:|INTERCUT|INSERT|SMASH CUT:|MATCH CUT:)/i.test(ln.trim());
    lines.forEach((ln, idx) => {
      if (isScene(ln)) {
        const title = ln.trim();
        const card = content.createDiv({ cls: 'caw-card' });
        card.createEl('h4', { text: title });
        const excerpt = lines.slice(idx+1, idx+5).join(' ').slice(0,160);
        card.createEl('p', { text: excerpt });
        card.addEventListener('click', async ()=> {
          const md = this.app.workspace.getActiveViewOfType(require('obsidian').MarkdownView);
          if (md) {
            const pos = this._findLine(md.editor, ln);
            if (pos !== -1) md.editor.setCursor({ line: pos, ch: 0 });
          }
        });
      }
    });
  }
  _findLine(editor, text) {
    const lines = editor.getValue().split('\n');
    return lines.findIndex(l => l === text);
  }
}

module.exports = class CoffeeAllWriter extends Plugin {
  async onload() {
    console.log('Loading Coffee All Writer v1.0.4');
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.state = { sessionStart: null, sessionWords: 0, lastCount: 0, streakByFile: {} };

    this.addSettingTab(new CAWSettingTab(this.app, this));

    // Ribbon + status
    this.addRibbonIcon('pen-tool', 'Coffee All Writer', () => this.toggleStoryboard());
    this.statusBar = this.addStatusBarItem();
    this.statusBar.addClass('caw-status');
    this.updateStatusBar();

    // Commands
    this.addCommand({ id: 'caw-insert-template', name: this.t('insertTemplate'), callback: () => this.insertTemplateLauncher() });
    this.addCommand({ id: 'caw-start-session', name: 'Iniciar sessão de escrita', callback: () => this.startSession() });
    this.addCommand({ id: 'caw-stop-session', name: 'Encerrar sessão de escrita', callback: () => this.stopSession() });

    // Keydown handlers
    this.registerDomEvent(document, 'keydown', (evt) => {
      // /script-<style> on Enter
      if (evt.key === 'Enter') {
        const view = this.app.workspace.getActiveViewOfType(require('obsidian').MarkdownView);
        const editor = view?.editor;
        if (editor) {
          const cur = editor.getCursor();
          const prev = Math.max(0, cur.line-1);
          const txt = (editor.getLine(prev)||'').trim();
          const m = txt.match(/^\/script-(\w+)/i);
          if (m) {
            const style = m[1].toLowerCase();
            editor.replaceRange('', {line:prev, ch:0}, {line:prev+1, ch:0});
            const f = this.app.workspace.getActiveFile();
            this.applyScriptDirective(style, f);
            return;
          }
        }
      }
      // Show contextual menu after Enter
      if (this.settings.showContextMenu && evt.key === 'Enter') {
        setTimeout(() => this.showMiniMenuIfApplicable(), 1);
      }
    });

    // Metrics on modify
    this.registerEvent(this.app.vault.on('modify', async (file) => {
      if (file instanceof TFile && file.extension === 'md') {
        await this.updateMetricsForFile(file);
        this.updateStatusBar();
      }
    }));

    // Process directive when opening file
    this.registerEvent(this.app.workspace.on('file-open', async (file)=>{ if (file) await this.handleSlashDirectiveOnOpen(file); }));

    // Storyboard view
    this.registerView(VIEW_TYPE_STORYBOARD, leaf => new StoryboardView(leaf, this));

    // Init
    this.startSession();
    const f = this.app.workspace.getActiveFile();
    if (f) await this.updateMetricsForFile(f);
    this.updateStatusBar();
  }

  onunload() { console.log('Unloading Coffee All Writer'); }

  /* ===== Helpers & I18N ===== */
  t(key) { const lang = I18N[this.settings.language] || I18N.pt; return lang[key] || key; }
  tl(path) { const lang = I18N[this.settings.language] || I18N.pt; return path.split('.').reduce((o,k)=>o?.[k], lang) ?? path; }

  templateForStyle(style) {
    const map = { cinema:'cinema.md', serie:'serie.md', rpg:'rpg.md', livro:'livro.md', biblia:'biblia_serie.md', jogos:'jogos.md', quadrinhos:'quadrinhos.md', ia:'ia_obra.md' };
    return map[style];
  }

  _inlineTemplates() {
    return {
      'rpg.md': `TÍTULO DA ONE-SHOT

INT. TAVERNA - NOITE
Descrição do ambiente. Objetivo dramático.

NPC
(parenthetical)
Diálogo do NPC.

JOGADOR
Diálogo / Ação do jogador.

Gancho/Desafio: ...

`,
      'livro.md': `TÍTULO DO LIVRO

Capítulo 1
Cenário / Descrição.
PERSONAGEM fala "em forma de diálogo".
(parenthetical)
[Ação narrativa]

`,
      'cinema.md': `TÍTULO DO ROTEIRO
FADE IN:

INT./EXT. LOCAL - DIA/NOITE
Ação/Descrição visual da cena.

PERSONAGEM
(parenthetical)
Diálogo.

TRANSIÇÃO: CUT TO:

`,
      'serie.md': `SÉRIE — TÍTULO DO EPISÓDIO

TEASER

INT. LOCAL - DIA
Ação/Descrição.

PERSONAGEM
(parenthetical)
Diálogo.

TRANSIÇÃO: CUT TO:

`,
      'biblia_serie.md': `BÍBLIA DE SÉRIE

Premissa: ...
Tom/Gênero/Público: ...
Personagens:
- Nome — conflitos e arco.

Mundo/Locações: ...
Estrutura de Temporada: ...
Temas/Mensagens: ...

`,
      'jogos.md': `DOCUMENTO DE JOGO

Visão / Loop central / Plataforma.
Mecânicas:
- Core loop
- Progredir/Falhar
- Controles

Narrativa / Missões / Personagens
Conteúdo / Arte / UI

`,
      'quadrinhos.md': `QUADRINHO — TÍTULO

PÁGINA 1
PAINEL 1
Descrição do painel.
BALÃO: fala
FX: efeito
[Ação]

`,
      'ia_obra.md': `OBRA DE IA — GUIA

Conceito
Dataset / Referências
Parâmetros / Prompt
Estilo visual / Narrativo

`
    };
  }

  /* ===== Sessions & Metrics ===== */
  startSession() { this.state.sessionStart = Date.now(); this.state.sessionWords = 0; this.state.lastCount = 0; new Notice(`${this.t('appName')}: sessão iniciada`); }
  stopSession() { const mins = Math.max(0, Math.round((Date.now()-this.state.sessionStart)/60000)); new Notice(`${this.t('appName')}: sessão encerrada (${mins} ${this.t('minutes')})`); }

  async updateMetricsForFile(file) {
    try {
      const content = await this.app.vault.read(file);
      const words = (content.match(/\b\w+\b/g) || []).length;
      const delta = Math.max(0, words - this.state.lastCount);
      this.state.lastCount = words; this.state.sessionWords += delta;

      const today = moment().format('YYYY-MM-DD');
      const key = file.path;
      const st = this.state.streakByFile[key] || { lastDates: new Set(), lastOpened: null };
      st.lastDates = new Set(st.lastDates); st.lastDates.add(today); st.lastOpened = today;
      this.state.streakByFile[key] = st;

      if (words >= 500) new Notice(I18N[this.settings.language].achievements.w500);
      if (words >= 1000) new Notice(I18N[this.settings.language].achievements.w1000);
      const streakLen = this._streakLength(st.lastDates);
      if (streakLen >= 7) new Notice(I18N[this.settings.language].achievements.streak7);
    } catch(e){ console.warn('Metrics error', e); }
  }
  _streakLength(dateSet) { let len=0, cur=moment(); while(dateSet.has(cur.format('YYYY-MM-DD'))){ len++; cur=cur.clone().subtract(1,'day'); } return len; }

  updateStatusBar() {
    const mins = this.state.sessionStart ? Math.max(0, Math.round((Date.now()-this.state.sessionStart)/60000)) : 0;
    const file = this.app.workspace.getActiveFile();
    let words = this.state.lastCount;
    const lang = I18N[this.settings.language] || I18N.pt;
    const streak = file ? this._streakLength(new Set(this.state.streakByFile[file.path]?.lastDates || [])) : 0;
    this.statusBar.setText(`${lang.timer} ${mins}${lang.minutes} • ${words} ${lang.words} • ${lang.streak}: ${streak}`);
  }

  /* ===== Templates ===== */
  async insertTemplateLauncher() {
    const tp = [
      { id: 'rpg', file: 'rpg.md', name: 'RPG' },
      { id: 'livro', file: 'livro.md', name: 'Livro' },
      { id: 'cinema', file: 'cinema.md', name: 'Cinema' },
      { id: 'serie', file: 'serie.md', name: 'Séries' },
      { id: 'biblia', file: 'biblia_serie.md', name: 'Bíblia de Série' },
      { id: 'jogos', file: 'jogos.md', name: 'Jogos' },
      { id: 'quadrinhos', file: 'quadrinhos.md', name: 'Quadrinhos' },
      { id: 'ia', file: 'ia_obra.md', name: 'Obras de IA' },
    ];
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice('Abra uma nota de destino.'); return; }

    const menu = new (require('obsidian').Menu)();
    menu.setNoIcon();
    menu.addItem((i)=>i.setTitle(this.t('chooseTemplate')).setDisabled(true));
    tp.forEach(t => {
      menu.addItem((i)=> i.setTitle(t.name).onClick(async ()=>{
        const inline = this._inlineTemplates()[t.file];
        if (inline) { await this._appendToFile(file, `\n${inline.trim()}\n`); return; }
        try {
          const resp = await fetch(`app://local/${this.manifest.dir}/templates/${t.file}`);
          const text = await resp.text();
          await this._appendToFile(file, `\n${text.trim()}\n`);
        } catch(e) { new Notice('Falha ao carregar template.'); }
      }));
    });
    menu.showAtMouseEvent({ x: window.innerWidth/2, y: 120, preventDefault: ()=>{} });
  }

  async _appendToFile(file, text) {
    const content = await this.app.vault.read(file);
    await this.app.vault.modify(file, content + (content.endsWith('\n')?'':'\n') + text);
  }

  async applyScriptDirective(style, file) {
    const tfile = this.templateForStyle(style);
    if (!tfile) { new Notice('Estilo não reconhecido: ' + style); return; }
    const inline = this._inlineTemplates()[tfile];
    if (inline) { await this._appendToFile(file, `\n${inline.trim()}\n`); return; }
    try {
      const resp = await fetch(`app://local/${this.manifest.dir}/templates/${tfile}`);
      const text = await resp.text();
      await this._appendToFile(file, `\n${text.trim()}\n`);
    } catch(e) { new Notice('Falha ao inserir template para /script-' + style); }
  }

  async handleSlashDirectiveOnOpen(file) {
    try {
      const content = await this.app.vault.read(file);
      const firstLine = (content.split('\n')[0] || '').trim();
      const m = firstLine.match(/^\/script-(\w+)/i);
      if (m) {
        const style = m[1].toLowerCase();
        const rest = content.split('\n').slice(1).join('\n');
        await this.app.vault.modify(file, rest);
        await this.applyScriptDirective(style, file);
      }
    } catch(e) { console.warn('directive on open error', e); }
  }

  /* ===== Context Mini Menu ===== */
  showMiniMenuIfApplicable() {
    const view = this.app.workspace.getActiveViewOfType(require('obsidian').MarkdownView);
    if (!view) return;
    const editor = view.editor; if (!editor) return;
    const cur = editor.getCursor();
    const lineText = editor.getLine(cur.line);
    if (lineText.trim() !== '') return;

    const menu = document.createElement('div');
    menu.className = 'caw-menu';
    const mk = (label, insert) => {
      const b = document.createElement('button'); b.textContent = label;
      b.addEventListener('click', () => { editor.replaceRange(insert, { line: cur.line, ch: 0 }); menu.remove(); });
      return b;
    };
    const add = (label, text) => menu.appendChild(mk(label, text));

    // Scene headings
    add('Scene Heading', 'INT./EXT. LOCAL - DIA/NOITE\n');
    add('INT.', 'INT. LOCAL - DIA\n');
    add('EXT.', 'EXT. LOCAL - NOITE\n');
    add('ESTABLISHING', 'ESTABLISHING SHOT - LOCAL\n');

    // Action & dialogue
    add(this.tl('menu.Descricao'), 'Ação/Descrição\n');
    add('Character', 'PERSONAGEM\n');
    add(this.tl('menu.Parenteses'), '(parenthetical)\n');
    add(this.tl('menu.Dialogo'), 'Diálogo.\n');
    add('V.O.', '(V.O.)\n');
    add('O.S.', '(O.S.)\n');
    add("CONT'D", "(CONT'D)\n");

    // Transitions
    add('Transition', 'TRANSIÇÃO: CUT TO:\n');
    add('SMASH CUT:', 'SMASH CUT:\n');
    add('MATCH CUT:', 'MATCH CUT:\n');
    add('DISSOLVE TO:', 'DISSOLVE TO:\n');
    add('FADE IN:', 'FADE IN:\n');
    add('FADE OUT:', 'FADE OUT.\n');

    // Shots
    add('SHOT', 'SHOT:\n');
    add('CLOSE UP', 'CLOSE UP:\n');
    add('WIDE', 'WIDE SHOT:\n');
    add('POV', 'POV:\n');
    add('OVER THE SHOULDER', 'OVER THE SHOULDER:\n');
    add('INSERT', 'INSERT:\n');
    add('INTERCUT', 'INTERCUT:\n');

    // Supers / titles
    add('SUPER:', 'SUPER: TÍTULO NA TELA\n');

    // Position menu near cursor
    const cm = view.editor.cm;
    const rect = cm?.cursorCoords ? cm.cursorCoords(true, 'page') : { left: 200, top: 200 };
    menu.style.left = (rect.left + 8) + 'px';
    menu.style.top = (rect.top + 8) + 'px';
    document.body.appendChild(menu);

    const closer = () => { menu.remove(); window.removeEventListener('click', closer, true); };
    window.addEventListener('click', closer, true);
  }

  /* ===== Storyboard Toggle ===== */
  async toggleStoryboard() {
    const leaf = this.app.workspace.getRightLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE_STORYBOARD, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
};

class CAWSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this; containerEl.empty();
    containerEl.createEl('h2', { text: 'Coffee All Writer — Configurações' });

    new Setting(containerEl)
      .setName('Idioma / Language')
      .setDesc('PT-BR ou EN')
      .addDropdown(d=> d.addOption('pt','Português')
        .addOption('en','English')
        .setValue(this.plugin.settings.language)
        .onChange(async (v)=>{ this.plugin.settings.language = v; await this.plugin.saveData(this.plugin.settings); this.plugin.updateStatusBar(); }));

    new Setting(containerEl)
      .setName('Mostrar menu contextual ao pular linha')
      .addToggle(t=> t.setValue(this.plugin.settings.showContextMenu)
        .onChange(async (v)=>{ this.plugin.settings.showContextMenu = v; await this.plugin.saveData(this.plugin.settings); }));
  }
}
