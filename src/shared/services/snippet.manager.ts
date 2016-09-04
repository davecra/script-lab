import {Injectable} from '@angular/core';
import {ISnippet, Snippet, SnippetNamingSuffixOption} from '../services';
import {StorageHelper, Utilities, ContextUtil, ContextType,
    ExpectedError, PlaygroundError, UxUtil} from '../helpers';
import {Http} from '@angular/http';

@Injectable()
export class SnippetManager {
    private _snippetsContainer: StorageHelper<ISnippet>;
    private currentContext: string;

    constructor (private _http: Http) { }
    /**
     * Must be called from every controller to ensure that the snippet manager uses
     * a correct snippet context (Excel vs. Word vs. Web).
     */
    initialize() {
        this._snippetsContainer = new StorageHelper<ISnippet>(ContextUtil.contextString + '_snippets');
    }

    new(): Promise<Snippet> {
        return this.add(SnippetManager.createBlankSnippet(this),
            SnippetNamingSuffixOption.StripNumericSuffixAndIncrement);
    }

    add(snippet: Snippet, suffixOption: SnippetNamingSuffixOption): Promise<Snippet> {
        return new Promise(resolve => {
            snippet.randomizeId(true /*force*/, this);
            snippet.makeNameUnique(suffixOption, this);
            resolve(this._addSnippetToLocalStorage(snippet));
        });
    }

    duplicate(snippet: ISnippet): Promise<Snippet> {
        return this.add(new Snippet(snippet), SnippetNamingSuffixOption.AddCopySuffix);
    }

    save(snippet: Snippet): Promise<ISnippet> {
        if (Utilities.isNull(snippet) || Utilities.isNull(snippet.meta)) {
            return Promise.reject(new Error('Snippet metadata cannot be empty')) as any;
        }
        if (Utilities.isEmpty(snippet.meta.name)) return Promise.reject(new Error('Snippet name cannot be empty')) as any;
        snippet.lastSavedHash = snippet.getHash();
        return Promise.resolve(this._snippetsContainer.insert(snippet.meta.id, snippet));
    }

    delete(snippet: ISnippet, askForConfirmation: boolean): Promise<any> {
        if (Utilities.isNull(snippet) || Utilities.isNull(snippet.meta)) {
            return Promise.reject(new Error('Snippet metadata cannot be empty'));
        }

        var that = this;

        if (askForConfirmation) {
            return UxUtil.showDialog('Delete confirmation',
                    `Are you sure you want to delete the snippet "${snippet.meta.name}"?`, ['Yes', 'No'])
                .then((choice) => {
                    if (choice === 'Yes') {
                        return deleteAndResolvePromise();
                    } else {
                        return Promise.reject(new ExpectedError());
                    }
                });
        } else {
            return deleteAndResolvePromise();
        }

        function deleteAndResolvePromise(): Promise<any> {
            that._snippetsContainer.remove(snippet.meta.id);
            return Promise.resolve();
        }
    }

    deleteAll(askForConfirmation: boolean): Promise<any> {
        var that = this;

        if (askForConfirmation) {
            return UxUtil.showDialog('Delete confirmation',
                    'Are you sure you want to delete *ALL* of your local snippets?', ['Yes', 'No'])
                .then((choice) => {
                    if (choice === 'Yes') {
                        return deleteAndResolvePromise();
                    } else {
                        return Promise.reject(new ExpectedError());
                    }
                });
        } else {
            return deleteAndResolvePromise();
        }

        function deleteAndResolvePromise(): Promise<any> {
            that._snippetsContainer.clear();
            return Promise.resolve();
        }
    }

    /**
     * Returns a list of local snippets.  Note that the initialize function of SnippetManager
     * MUST be called before issuing this call, or else you'll always get an empty list.
     */
    getLocal(): ISnippet[] {
        if (this._snippetsContainer) {
            return this._snippetsContainer.values();
        }

        return [];
    }

    getPlaylist(): Promise<ISnippetGallery> {
        var snippetJsonUrl = location.origin + '/assets/snippets/' + ContextUtil.contextString + '.json';
        
        return this._http.get(snippetJsonUrl)
            .toPromise()
            .then(response => {
                var json = response.json();
                return json;
            })
            .catch((e) => {
                var messages = ['Could not retrieve default snippets for ' + ContextUtil.hostName + '.'];
                Utilities.appendToArray(messages, UxUtil.extractErrorMessage(e)); 
                throw new PlaygroundError(messages);
            });
    }

    find(id: string): Promise<Snippet> {
        return new Promise(resolve => {
            var result = this._snippetsContainer.get(id);
            resolve(new Snippet(result));
        });
    }

    private _addSnippetToLocalStorage(snippet: Snippet) {
        this._snippetsContainer.add(snippet.meta.id, snippet);
        return snippet;
    }

    static createBlankSnippet(snippetManager: SnippetManager) {
        if (ContextUtil.isOfficeContext) {
            return createBlankOfficeJsSnippet();
        } else {
            // Theoretically shouldn't happen, but leaving it in just in case:
            createBlankGenericSnippet();
        }

        function createBlankOfficeJsSnippet(): Snippet {
            var script: string;

            // For new host-specific APIs, use the new syntax
            // However, if detect that this is running inside an add-in and on an old client,
            // Revert back to the Office 2013 code.
            var useHostSpecificApiSample = (ContextUtil.contextNamespace != null);
            if (ContextUtil.isAddin && !Office.context.requirements.isSetSupported(ContextUtil.contextNamespace + 'Api')) {
                useHostSpecificApiSample = false;
            }

            if (useHostSpecificApiSample) {
                script = Utilities.stripSpaces(`
                    ${ContextUtil.contextNamespace}.run(function(context) {
                        // insert your code here...
                        return context.sync();
                    }).catch(function(error) {
                        console.log(error);
                        if (error instanceof OfficeExtension.Error) {
                            console.log("Debug info: " + JSON.stringify(error.debugInfo));
                        }
                    });
                `)
            } else {
                script = Utilities.stripSpaces(`
                    Office.context.document.getSelectedDataAsync(Office.CoercionType.Text,
                        function (asyncResult) {
                            if (asyncResult.status === Office.AsyncResultStatus.Failed) {
                                console.log(asyncResult.error.message);
                            } else {
                                console.log('Selected data is ' + asyncResult.value);
                            }            
                        }
                    );
                `);
            }

            return new Snippet({
                script: script,
                libraries: Utilities.stripSpaces(`
                    # Office.js CDN reference
                    //appsforoffice.microsoft.com/lib/1/hosted/Office.js

                    # NPM CDN references
                    jquery
                    office-ui-fabric/dist/js/jquery.fabric.min.js
                    office-ui-fabric/dist/css/fabric.min.css
                    office-ui-fabric/dist/css/fabric.components.min.css

                    # IntelliSense definitions
                    //raw.githubusercontent.com/DefinitelyTyped/DefinitelyTyped/master/office-js/office-js.d.ts
                    //raw.githubusercontent.com/DefinitelyTyped/DefinitelyTyped/master/jquery/jquery.d.ts

                    # Note: for any "loose" typescript definitions, you can paste them at the bottom of your TypeScript/JavaScript code in the "Script" tab.
                `)
            });
        }

        function createBlankGenericSnippet(): Snippet {
            return new Snippet({
                script: 'console.log("Hello world");',
                libraries: Utilities.stripSpaces(`
                    # NPM CDN references
                    jquery
                    office-ui-fabric/dist/js/jquery.fabric.min.js
                    office-ui-fabric/dist/css/fabric.min.css
                    office-ui-fabric/dist/css/fabric.components.min.css

                    # IntelliSense definitions
                    //raw.githubusercontent.com/DefinitelyTyped/DefinitelyTyped/master/jquery/jquery.d.ts

                    # Note: for any "loose" typescript definitions, you can paste them at the bottom of your TypeScript/JavaScript code in the "Script" tab.
                `)
            });
        }
    }
}

export interface ISnippetGallery {
    groups: Array<{
        name: string,
        items: Array<{
            name: string,
            description: string,
            gistId: string
        }>
    }>
}