const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

async function runUpdate() {
  console.log('🚀 Starting Ivaa AdSync Content Workflow Update...\n');

  try {
    // Step 1: Check connection
    console.log('📡 Checking database connection...');
    const connTest = await pool.query('SELECT NOW()');
    console.log('✅ Database connected at:', connTest.rows[0].now);
    console.log();

    // Step 2: Check current database state
    console.log('🔍 Checking current database state...');

    // Check if content table exists
    const contentTableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'content'
      );
    `);

    if (!contentTableExists.rows[0].exists) {
      console.log('❌ Content table does not exist. Please run the initial migration first:');
      console.log('   npm run migrate -- --force');
      process.exit(1);
    }

    // Check existing columns
    const existingColumns = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'content'
      ORDER BY ordinal_position;
    `);

    console.log('📋 Current content table columns:');
    existingColumns.rows.forEach(col => {
      console.log(`   - ${col.column_name}`);
    });
    console.log();

    // Step 3: Check if update is needed
    const hasDesignColumns = existingColumns.rows.some(col =>
      col.column_name === 'designed_by' ||
      col.column_name === 'designed_file_url'
    );

    if (hasDesignColumns) {
      console.log('✅ Content workflow columns already exist.');
      console.log('   Migration may have already been applied.');

      if (process.argv[2] !== '--force') {
        console.log('\nTo force re-run the update, use: npm run update -- --force');
        process.exit(0);
      }
    }

    // Step 4: Run the safe migration
    console.log('🔄 Applying content workflow update...\n');

    const migrationSQL = fs.readFileSync(
      path.join(__dirname, 'migrations', '002_content_workflow_safe.sql'),
      'utf8'
    );

    // Execute migration in a transaction
    await pool.query('BEGIN');

    try {
      // Split by statements and execute individually for better error handling
      const statements = migrationSQL
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (const statement of statements) {
        if (statement.toUpperCase().startsWith('BEGIN') ||
            statement.toUpperCase().startsWith('COMMIT')) {
          continue; // Skip transaction commands as we're managing them here
        }

        try {
          await pool.query(statement + ';');
        } catch (err) {
          // Some statements might fail if already applied, that's OK
          if (!err.message.includes('already exists') &&
              !err.message.includes('duplicate key')) {
            throw err;
          }
        }
      }

      await pool.query('COMMIT');
      console.log('✅ Content workflow update applied successfully!\n');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }

    // Step 5: Verify the update
    console.log('📊 Update Verification:');

    // Check new columns
    const newColumns = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'content'
      AND column_name IN ('designed_by', 'designed_at', 'designed_file_url',
                          'published_by', 'published_at', 'original_filename')
      ORDER BY column_name;
    `);

    console.log('\n✅ New workflow columns:');
    newColumns.rows.forEach(col => {
      console.log(`   - ${col.column_name} (${col.data_type}) ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
    });

    // Check status constraint
    const statusConstraint = await pool.query(`
      SELECT pg_get_constraintdef(oid) as definition
      FROM pg_constraint
      WHERE conrelid = 'content'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%';
    `);

    if (statusConstraint.rows.length > 0) {
      console.log('\n✅ Status constraint updated:');
      console.log(`   ${statusConstraint.rows[0].definition}`);
    }

    // Check content statistics
    const stats = await pool.query(`
      SELECT
        status,
        COUNT(*) as count
      FROM content
      GROUP BY status
      ORDER BY
        CASE status
          WHEN 'pending' THEN 1
          WHEN 'in_design' THEN 2
          WHEN 'designed' THEN 3
          WHEN 'approved' THEN 4
          WHEN 'rejected' THEN 5
          WHEN 'published' THEN 6
          ELSE 7
        END;
    `);

    console.log('\n📈 Content Status Distribution:');
    if (stats.rows.length > 0) {
      stats.rows.forEach(stat => {
        console.log(`   - ${stat.status}: ${stat.count} items`);
      });
    } else {
      console.log('   No content items yet');
    }

    // Check indexes
    const indexes = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'content'
      AND indexname LIKE '%design%' OR indexname LIKE '%publish%';
    `);

    if (indexes.rows.length > 0) {
      console.log('\n✅ Performance indexes created:');
      indexes.rows.forEach(idx => {
        console.log(`   - ${idx.indexname}`);
      });
    }

    console.log('\n🎉 Content workflow update completed successfully!');
    console.log('\n📝 New Workflow:');
    console.log('   1. Owner uploads content → Status: pending');
    console.log('   2. Designer starts editing → Status: in_design');
    console.log('   3. Designer uploads edited version → Status: designed');
    console.log('   4. Admin reviews designed content → Status: approved/rejected');
    console.log('   5. Designer publishes approved content → Status: published');
    console.log('\n✨ The system now supports the complete content workflow!');

  } catch (error) {
    console.error('\n❌ Update failed:', error.message);

    if (error.code === 'ENOENT') {
      console.error('\n📁 Migration file not found!');
      console.error('   Make sure 002_content_workflow_safe.sql exists in src/database/migrations/');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('\n🔌 Cannot connect to database!');
      console.error('   Check your database configuration in .env');
    } else {
      console.error('\nFull error:', error);
    }

    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run update
runUpdate();