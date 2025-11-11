import express from 'express';
import { AdapterFactory } from '../adapters/AdapterFactory.js';
import { logCustomerActivity } from '../config/supabase.js';

export const dataRouter = express.Router();

dataRouter.get('/:customerId/records', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { tableId, limit, offset, filter, sort } = req.query;

    const adapter = await AdapterFactory.getAdapter(customerId, tableId);

    const options = {
      limit: limit ? parseInt(limit) : 100,
      offset: offset ? parseInt(offset) : 0
    };

    if (filter) {
      try {
        options.filter = JSON.parse(filter);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid filter format' });
      }
    }

    if (sort) {
      options.sort = sort;
    }

    const geojson = await adapter.fetchRecords(options);

    geojson.dataSource = adapter.getDataSourceType();

    res.json(geojson);
  } catch (error) {
    console.error('Error fetching records:', error);
    res.status(500).json({ error: error.message });
  }
});

dataRouter.get('/:customerId/records/:id', async (req, res) => {
  try {
    const { customerId, id } = req.params;
    const { tableId } = req.query;

    const adapter = await AdapterFactory.getAdapter(customerId, tableId);
    const feature = await adapter.getRecord(id);

    if (!feature) {
      return res.status(404).json({ error: 'Record not found' });
    }

    res.json(feature);
  } catch (error) {
    console.error('Error fetching record:', error);
    res.status(500).json({ error: error.message });
  }
});

dataRouter.post('/:customerId/records', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { tableId } = req.query;
    const feature = req.body;

    if (!feature || feature.type !== 'Feature') {
      return res.status(400).json({ error: 'Request body must be a GeoJSON Feature' });
    }

    const adapter = await AdapterFactory.getAdapter(customerId, tableId);
    const created = await adapter.createRecord(feature);

    await logCustomerActivity(
      customerId,
      req.body.userEmail || 'system',
      'record_created',
      `Record created via ${adapter.getDataSourceType()}`,
      { recordId: created.id }
    );

    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating record:', error);
    res.status(500).json({ error: error.message });
  }
});

dataRouter.put('/:customerId/records/:id', async (req, res) => {
  try {
    const { customerId, id } = req.params;
    const { tableId } = req.query;
    const feature = req.body;

    if (!feature || feature.type !== 'Feature') {
      return res.status(400).json({ error: 'Request body must be a GeoJSON Feature' });
    }

    const adapter = await AdapterFactory.getAdapter(customerId, tableId);
    const updated = await adapter.updateRecord(id, feature);

    await logCustomerActivity(
      customerId,
      req.body.userEmail || 'system',
      'record_updated',
      `Record ${id} updated via ${adapter.getDataSourceType()}`,
      { recordId: id }
    );

    res.json(updated);
  } catch (error) {
    console.error('Error updating record:', error);
    res.status(500).json({ error: error.message });
  }
});

dataRouter.delete('/:customerId/records/:id', async (req, res) => {
  try {
    const { customerId, id } = req.params;
    const { tableId } = req.query;

    const adapter = await AdapterFactory.getAdapter(customerId, tableId);
    const result = await adapter.deleteRecord(id);

    await logCustomerActivity(
      customerId,
      req.query.userEmail || 'system',
      'record_deleted',
      `Record ${id} deleted via ${adapter.getDataSourceType()}`,
      { recordId: id }
    );

    res.json(result);
  } catch (error) {
    console.error('Error deleting record:', error);
    res.status(500).json({ error: error.message });
  }
});

dataRouter.get('/:customerId/schema', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { tableId } = req.query;

    const adapter = await AdapterFactory.getAdapter(customerId, tableId);
    const schema = await adapter.getSchema();

    res.json({
      dataSource: adapter.getDataSourceType(),
      fields: schema
    });
  } catch (error) {
    console.error('Error fetching schema:', error);
    res.status(500).json({ error: error.message });
  }
});

dataRouter.get('/:customerId/tables', async (req, res) => {
  try {
    const { customerId } = req.params;

    const adapter = await AdapterFactory.getAdapter(customerId);
    const tables = await adapter.getTableList();

    res.json({
      dataSource: adapter.getDataSourceType(),
      tables: tables
    });
  } catch (error) {
    console.error('Error fetching tables:', error);
    res.status(500).json({ error: error.message });
  }
});
