import { Icon } from '@iconify/vue';
import { h, ref, render, type VNode } from 'vue';

interface DialogButton {
    label: string;
    toggled?: boolean;
    onClick: () => void;
}

interface DialogOptions {
    title: string;
    message: string;
    icon?: string;
    iconClass?: string;
    buttons: DialogButton[];
}

export function useDialog() {
    const showDialog = (options: DialogOptions): Promise<void> => {
        return new Promise(resolve => {
            const dialogEl = document.createElement('dialog');
            dialogEl.classList.add('wb-dialog');

            const children: VNode[] = [];

            if (options.icon) {
                children.push(
                    h(Icon, {
                        class: options.iconClass || 'text-indigo-400 size-12',
                        icon: options.icon,
                    }),
                );
            }

            children.push(h('h3', { class: 'mt-2' }, options.title));

            const messageLines = options.message.split('\n');
            if (messageLines.length > 1) {
                children.push(h('div', { class: 'max-w-[60vw] whitespace-pre-line' }, options.message));
            } else {
                children.push(h('p', { class: 'max-w-[40vw]' }, options.message));
            }

            const footerButtons = options.buttons.map(btn => {
                return h(
                    'x-button',
                    {
                        toggled: btn.toggled || false,
                        onClick: () => {
                            btn.onClick();
                            dialogEl.close();
                            cleanup();
                        },
                    },
                    {
                        default: () => h('x-label', null, btn.label),
                    },
                );
            });

            children.push(h('footer', null, footerButtons));

            const vnode = h('div', { class: 'flex flex-col items-center text-center' }, children);

            const container = document.createElement('div');
            dialogEl.appendChild(container);
            render(vnode, container);

            document.body.appendChild(dialogEl);
            dialogEl.showModal();

            const cleanup = () => {
                render(null, container);
                dialogEl.remove();
                resolve();
            };

            dialogEl.addEventListener('click', e => {
                if (e.target === dialogEl) {
                    dialogEl.close();
                    cleanup();
                }
            });

            dialogEl.addEventListener('cancel', e => {
                e.preventDefault();
                dialogEl.close();
                cleanup();
            });
        });
    };

    const confirm = (title: string, message: string, icon?: string): Promise<boolean> => {
        return new Promise(resolve => {
            showDialog({
                title,
                message,
                icon: icon || 'mdi:help-circle-outline',
                iconClass: 'text-indigo-400 size-12',
                buttons: [
                    {
                        label: 'Cancel',
                        toggled: false,
                        onClick: () => resolve(false),
                    },
                    {
                        label: 'OK',
                        toggled: true,
                        onClick: () => resolve(true),
                    },
                ],
            });
        });
    };

    const alert = (title: string, message: string, icon?: string, iconClass?: string): Promise<void> => {
        return showDialog({
            title,
            message,
            icon: icon || 'mdi:information-outline',
            iconClass: iconClass || 'text-indigo-400 size-12',
            buttons: [
                {
                    label: 'OK',
                    toggled: true,
                    onClick: () => {},
                },
            ],
        });
    };

    return {
        showDialog,
        confirm,
        alert,
    };
}
