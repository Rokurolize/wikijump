<script lang="ts">
  import { resolve } from "$app/paths"
</script>

<section id="site-backup" class="admin-section">
  <div class="page-header"><h2>Backup</h2></div>
  <p>Download the current site backup archive.</p>
  <p>
    <a href={resolve("-/admin/backup")} download>Download site backup archive</a>
  </p>
</section>
