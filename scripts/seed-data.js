import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'teable_salt_2024').digest('hex');
}

async function seedDatabase() {
  console.log('🌱 Starting database seeding...\n');

  try {
    console.log('1️⃣  Creating super admin account...');
    const { data: admin, error: adminError } = await supabase
      .from('system_admins')
      .insert({
        email: 'admin@gissystem.com',
        password_hash: hashPassword('admin123'),
        first_name: 'Super',
        last_name: 'Admin',
        is_super_admin: true,
        is_active: true
      })
      .select()
      .single();

    if (adminError && !adminError.message.includes('duplicate')) {
      throw adminError;
    }

    console.log('✅ Super admin created: admin@gissystem.com / admin123\n');

    console.log('2️⃣  Creating test customers...');

    const testCustomers = [
      {
        name: 'Acme Corporation',
        subdomain: 'acme',
        status: 'active',
        subscription_tier: 'pro',
        primary_color: '#2563eb',
        secondary_color: '#1e40af',
        max_users: 10,
        max_map_views: 10000
      },
      {
        name: 'Global Logistics Inc',
        subdomain: 'globallogistics',
        status: 'active',
        subscription_tier: 'enterprise',
        primary_color: '#059669',
        secondary_color: '#047857',
        max_users: 50,
        max_map_views: 100000
      },
      {
        name: 'City Planning Department',
        subdomain: 'cityplanning',
        status: 'trial',
        subscription_tier: 'starter',
        primary_color: '#7c3aed',
        secondary_color: '#6d28d9',
        max_users: 5,
        max_map_views: 1000
      },
      {
        name: 'Environmental Research Group',
        subdomain: 'envresearch',
        status: 'active',
        subscription_tier: 'pro',
        primary_color: '#0891b2',
        secondary_color: '#0e7490',
        max_users: 15,
        max_map_views: 50000
      },
      {
        name: 'Real Estate Analytics',
        subdomain: 'realestate',
        status: 'trial',
        subscription_tier: 'starter',
        primary_color: '#dc2626',
        secondary_color: '#b91c1c',
        max_users: 5,
        max_map_views: 5000
      }
    ];

    const createdCustomers = [];

    for (const customerData of testCustomers) {
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 30);

      const { data: customer, error: customerError } = await supabase
        .from('customers')
        .insert({
          ...customerData,
          trial_ends_at: trialEndsAt.toISOString()
        })
        .select()
        .single();

      if (customerError && !customerError.message.includes('duplicate')) {
        console.error(`Error creating ${customerData.name}:`, customerError);
        continue;
      }

      createdCustomers.push(customer || customerData);
      console.log(`   ✅ ${customerData.name} - ${customerData.subdomain}.mapz.in`);
    }

    console.log(`\n✅ Created ${createdCustomers.length} test customers\n`);

    console.log('3️⃣  Creating sample Teable.io configurations...');

    for (const customer of createdCustomers) {
      if (!customer.id) continue;

      const { error: configError } = await supabase
        .from('customer_teable_config')
        .insert({
          customer_id: customer.id,
          base_url: 'https://app.teable.io',
          space_id: `space_${customer.subdomain}_sample`,
          base_id: `base_${customer.subdomain}_sample`,
          access_token: `token_sample_${customer.subdomain}_${Date.now()}`,
          is_active: true
        });

      if (configError && !configError.message.includes('duplicate')) {
        console.error(`Error creating config for ${customer.name}:`, configError);
      }
    }

    console.log('✅ Sample Teable.io configurations created\n');

    console.log('4️⃣  Creating test customer users...');

    for (const customer of createdCustomers) {
      if (!customer.id) continue;

      const users = [
        {
          customer_id: customer.id,
          email: `owner@${customer.subdomain}.com`,
          first_name: 'Owner',
          last_name: 'User',
          role: 'owner',
          is_active: true
        },
        {
          customer_id: customer.id,
          email: `admin@${customer.subdomain}.com`,
          first_name: 'Admin',
          last_name: 'User',
          role: 'admin',
          is_active: true
        },
        {
          customer_id: customer.id,
          email: `editor@${customer.subdomain}.com`,
          first_name: 'Editor',
          last_name: 'User',
          role: 'editor',
          is_active: true
        }
      ];

      for (const user of users) {
        const { error: userError } = await supabase
          .from('customer_users')
          .insert(user);

        if (userError && !userError.message.includes('duplicate')) {
          console.error(`Error creating user for ${customer.name}:`, userError);
        }
      }

      console.log(`   ✅ Created users for ${customer.name}`);
    }

    console.log('\n✅ Test customer users created\n');

    console.log('5️⃣  Creating sample activity logs...');

    for (const customer of createdCustomers) {
      if (!customer.id) continue;

      const activities = [
        {
          customer_id: customer.id,
          user_email: 'admin@gissystem.com',
          action_type: 'customer_created',
          action_description: `Customer ${customer.name} created`,
          metadata: { source: 'seed_script' }
        },
        {
          customer_id: customer.id,
          user_email: `owner@${customer.subdomain}.com`,
          action_type: 'user_login',
          action_description: 'Owner logged in for the first time',
          metadata: { source: 'seed_script' }
        }
      ];

      for (const activity of activities) {
        const { error: activityError } = await supabase
          .from('customer_activity_logs')
          .insert(activity);

        if (activityError) {
          console.error(`Error creating activity for ${customer.name}:`, activityError);
        }
      }
    }

    console.log('✅ Sample activity logs created\n');

    console.log('6️⃣  Creating sample usage metrics...');

    for (const customer of createdCustomers) {
      if (!customer.id) continue;

      const today = new Date();
      const metrics = [];

      for (let i = 0; i < 7; i++) {
        const metricDate = new Date(today);
        metricDate.setDate(metricDate.getDate() - i);

        metrics.push({
          customer_id: customer.id,
          metric_date: metricDate.toISOString().split('T')[0],
          map_views: Math.floor(Math.random() * 500) + 100,
          api_calls: Math.floor(Math.random() * 1000) + 200,
          active_users: Math.floor(Math.random() * 10) + 1,
          storage_used_mb: Math.floor(Math.random() * 500) + 50
        });
      }

      for (const metric of metrics) {
        const { error: metricError } = await supabase
          .from('customer_usage_metrics')
          .insert(metric);

        if (metricError && !metricError.message.includes('duplicate')) {
          console.error(`Error creating metric for ${customer.name}:`, metricError);
        }
      }

      console.log(`   ✅ Created metrics for ${customer.name}`);
    }

    console.log('\n✅ Sample usage metrics created\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 Database seeding completed successfully!\n');
    console.log('📋 Summary:');
    console.log('   • 1 Super Admin Account Created');
    console.log(`   • ${createdCustomers.length} Test Customers Created`);
    console.log(`   • ${createdCustomers.length * 3} Customer Users Created`);
    console.log(`   • ${createdCustomers.length} Teable.io Configs Created`);
    console.log('   • Sample activity logs and metrics added\n');
    console.log('🔐 Admin Login Credentials:');
    console.log('   Email: admin@gissystem.com');
    console.log('   Password: admin123\n');
    console.log('🌐 Test Customer Subdomains:');
    testCustomers.forEach(c => {
      console.log(`   • ${c.subdomain}.mapz.in - ${c.name}`);
    });
    console.log('\n💡 Next Steps:');
    console.log('   1. Start the server: npm run server');
    console.log('   2. Login at: http://mapz.in/admin-login.html');
    console.log('   3. Explore customers and customize HTML');
    console.log('   4. Test subdomain routing at http://acme.mapz.in');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('\n❌ Error seeding database:', error);
    process.exit(1);
  }
}

seedDatabase();
