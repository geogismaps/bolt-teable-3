class LayerPreferencesManager {
    constructor() {
        this.supabase = null;
        this.currentUser = null;
        this.preferencesCache = new Map();
        this.autoSaveTimeout = null;
        this.autoSaveDelay = 2000;
    }

    initialize(supabaseClient, user) {
        this.supabase = supabaseClient;
        this.currentUser = user;
        console.log('LayerPreferencesManager initialized for user:', user.email);
    }

    async saveLayerPreference(layerId, layerName, configuration) {
        if (!this.supabase || !this.currentUser) {
            console.error('LayerPreferencesManager not initialized');
            return false;
        }

        try {
            const preference = {
                user_email: this.currentUser.email,
                customer_id: this.currentUser.customerId,
                layer_id: layerId,
                layer_name: layerName,
                configuration: configuration,
                is_active: true
            };

            const { data: existing } = await this.supabase
                .from('user_layer_preferences')
                .select('id')
                .eq('user_email', this.currentUser.email)
                .eq('layer_id', layerId)
                .maybeSingle();

            let result;
            if (existing) {
                result = await this.supabase
                    .from('user_layer_preferences')
                    .update({
                        configuration: configuration,
                        layer_name: layerName,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', existing.id);
            } else {
                result = await this.supabase
                    .from('user_layer_preferences')
                    .insert([preference]);
            }

            if (result.error) {
                console.error('Error saving layer preference:', result.error);
                return false;
            }

            this.preferencesCache.set(layerId, configuration);
            console.log(`✅ Saved preferences for layer: ${layerName}`);
            return true;
        } catch (error) {
            console.error('Error saving layer preference:', error);
            return false;
        }
    }

    async loadLayerPreference(layerId) {
        if (!this.supabase || !this.currentUser) {
            console.error('LayerPreferencesManager not initialized');
            return null;
        }

        if (this.preferencesCache.has(layerId)) {
            return this.preferencesCache.get(layerId);
        }

        try {
            const { data, error } = await this.supabase
                .from('user_layer_preferences')
                .select('*')
                .eq('user_email', this.currentUser.email)
                .eq('layer_id', layerId)
                .eq('is_active', true)
                .maybeSingle();

            if (error) {
                console.error('Error loading layer preference:', error);
                return null;
            }

            if (data && data.configuration) {
                this.preferencesCache.set(layerId, data.configuration);
                console.log(`✅ Loaded preferences for layer: ${data.layer_name}`);
                return data.configuration;
            }

            return null;
        } catch (error) {
            console.error('Error loading layer preference:', error);
            return null;
        }
    }

    async loadAllUserPreferences() {
        if (!this.supabase || !this.currentUser) {
            console.error('LayerPreferencesManager not initialized');
            return [];
        }

        try {
            const { data, error } = await this.supabase
                .from('user_layer_preferences')
                .select('*')
                .eq('user_email', this.currentUser.email)
                .eq('is_active', true)
                .order('updated_at', { ascending: false });

            if (error) {
                console.error('Error loading user preferences:', error);
                return [];
            }

            if (data) {
                data.forEach(pref => {
                    this.preferencesCache.set(pref.layer_id, pref.configuration);
                });
                console.log(`✅ Loaded ${data.length} layer preferences from database`);
            }

            return data || [];
        } catch (error) {
            console.error('Error loading all preferences:', error);
            return [];
        }
    }

    async deleteLayerPreference(layerId) {
        if (!this.supabase || !this.currentUser) {
            console.error('LayerPreferencesManager not initialized');
            return false;
        }

        try {
            const { error } = await this.supabase
                .from('user_layer_preferences')
                .delete()
                .eq('user_email', this.currentUser.email)
                .eq('layer_id', layerId);

            if (error) {
                console.error('Error deleting layer preference:', error);
                return false;
            }

            this.preferencesCache.delete(layerId);
            console.log(`✅ Deleted preferences for layer: ${layerId}`);
            return true;
        } catch (error) {
            console.error('Error deleting layer preference:', error);
            return false;
        }
    }

    scheduleAutoSave(layerId, layerName, configuration) {
        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
        }

        this.autoSaveTimeout = setTimeout(() => {
            this.saveLayerPreference(layerId, layerName, configuration);
        }, this.autoSaveDelay);
    }

    extractLayerConfiguration(layer) {
        return {
            symbology: layer.properties?.symbology || null,
            labels: layer.properties?.labels || null,
            filters: layer.filters || [],
            popup: layer.properties?.popup || null,
            visibility: layer.visible !== false,
            opacity: layer.opacity || 1.0,
            lastModified: new Date().toISOString()
        };
    }

    applyConfigurationToLayer(layer, configuration) {
        if (!configuration) return layer;

        if (!layer.properties) {
            layer.properties = {};
        }

        if (configuration.symbology) {
            layer.properties.symbology = configuration.symbology;
        }

        if (configuration.labels) {
            layer.properties.labels = configuration.labels;
        }

        if (configuration.filters) {
            layer.filters = configuration.filters;
        }

        if (configuration.popup) {
            layer.properties.popup = configuration.popup;
        }

        if (configuration.visibility !== undefined) {
            layer.visible = configuration.visibility;
        }

        if (configuration.opacity !== undefined) {
            layer.opacity = configuration.opacity;
        }

        return layer;
    }

    clearCache() {
        this.preferencesCache.clear();
        console.log('Layer preferences cache cleared');
    }
}

window.layerPreferencesManager = new LayerPreferencesManager();
