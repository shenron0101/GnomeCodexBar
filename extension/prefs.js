import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const PROVIDERS = ['claude', 'openrouter', 'copilot', 'codex'];
const DISPLAY_MODES = ['cost', 'utilization'];
const DISPLAY_MODE_LABELS = ['Cost ($)', '5h Utilization (%)'];

export default class UsageTuiPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        const displayGroup = new Adw.PreferencesGroup({title: 'Panel Display'});
        page.add(displayGroup);

        const modeModel = new Gtk.StringList();
        for (const label of DISPLAY_MODE_LABELS)
            modeModel.append(label);

        const modeRow = new Adw.ComboRow({
            title: 'Display mode',
            subtitle: 'What to show in the top bar',
            model: modeModel,
        });

        const currentMode = settings.get_string('display-mode');
        modeRow.selected = Math.max(0, DISPLAY_MODES.indexOf(currentMode));

        modeRow.connect('notify::selected', () => {
            settings.set_string('display-mode', DISPLAY_MODES[modeRow.selected] ?? 'cost');
        });

        displayGroup.add(modeRow);

        const iconRow = new Adw.SwitchRow({
            title: 'Show panel icon',
            subtitle: 'Show the monitor icon to the left of the panel label',
        });
        iconRow.active = settings.get_boolean('show-panel-icon');
        iconRow.connect('notify::active', () => {
            settings.set_boolean('show-panel-icon', iconRow.active);
        });
        displayGroup.add(iconRow);

        const prefixRow = new Adw.SwitchRow({
            title: 'Show provider prefixes',
            subtitle: 'Show C:, CX: etc. before percentages in the panel label',
        });
        prefixRow.active = settings.get_boolean('show-provider-prefix');
        prefixRow.connect('notify::active', () => {
            settings.set_boolean('show-provider-prefix', prefixRow.active);
        });
        displayGroup.add(prefixRow);

        const providersGroup = new Adw.PreferencesGroup({
            title: 'Included Providers',
            description: 'Which providers to include in the panel label',
        });
        page.add(providersGroup);

        for (const provider of PROVIDERS) {
            const row = new Adw.SwitchRow({title: provider});
            row.active = settings.get_strv('included-providers').includes(provider);

            row.connect('notify::active', () => {
                const current = settings.get_strv('included-providers');
                if (row.active && !current.includes(provider))
                    settings.set_strv('included-providers', [...current, provider]);
                else if (!row.active)
                    settings.set_strv('included-providers', current.filter(p => p !== provider));
            });

            providersGroup.add(row);
        }
    }
}
