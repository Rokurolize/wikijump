<script lang="ts">
  import type { PageProps } from "./$types"

  let { data }: PageProps = $props()
</script>

<h1>UNTRANSLATED: Info page</h1>

<table class="platform-info">
  <tbody>
    <tr class="info-header">
      <th colspan="2">UT:Backend</th>
    </tr>
    <tr class="info-attribute-row">
      <th class="info-attribute-name">UT:Package name</th>
      <td class="info-attribute-value">{data.backend.package.name}</td>
    </tr>
    <tr class="info-attribute-row">
      <th class="info-attribute-name">UT:Package description</th>
      <td class="info-attribute-value">{data.backend.package.description}</td>
    </tr>
    <tr class="info-attribute-row">
      <th class="info-attribute-name">UT:Package license</th>
      <td class="info-attribute-value">{data.backend.package.license}</td>
    </tr>
    <tr class="info-attribute-row">
      <th class="info-attribute-name">UT:Package repository</th>
      <td class="info-attribute-value">
        <a href={data.backend.package.repository} rel="external">
          {data.backend.package.repository}
        </a>
      </td>
    </tr>
    <tr class="info-attribute-row">
      <th class="info-attribute-name">UT:Package version</th>
      <td class="info-attribute-value">{data.backend.package.version}</td>
    </tr>
    <tr class="info-attribute-row">
      <th class="info-attribute-name">UT:Rustc version</th>
      <td class="info-attribute-value">{data.backend.compile_info.rustc_version}</td>
    </tr>
  </tbody>
  <tbody>
    <tr class="info-header">
      <th colspan="2">UT:Frontend</th>
    </tr>
    <tr class="info-attribute-row">
      <th class="info-attribute-name">UT:Package name</th>
      <td class="info-attribute-value">{data.frontend.name}</td>
    </tr>
    <tr class="info-attribute-row">
      <th class="info-attribute-name">UT:Package description</th>
      <td class="info-attribute-value">{data.frontend.description}</td>
    </tr>
    <tr class="info-attribute-row">
      <th class="info-attribute-name">UT:Package license</th>
      <td class="info-attribute-value">{data.frontend.license}</td>
    </tr>
    <tr class="info-attribute-row">
      <th class="info-attribute-name">UT:Package repository</th>
      <td class="info-attribute-value">
        <a href={data.frontend.repository} rel="external">
          {data.frontend.repository}
        </a>
      </td>
    </tr>
    <tr class="info-attribute-row">
      <th class="info-attribute-name">UT:Package version</th>
      <td class="info-attribute-value">{data.frontend.version}</td>
    </tr>
    <tr class="info-attribute-row">
      <th class="info-attribute-name">UT:Node version</th>
      <td class="info-attribute-value">{data.frontend.node}</td>
    </tr>
    <tr class="info-attribute-row">
      <th class="info-attribute-name">UT:Pnpm version</th>
      <td class="info-attribute-value">{data.frontend.pnpm}</td>
    </tr>
  </tbody>
</table>

<style lang="scss">
  // Contain long package, repository, and version values inside the viewport
  // instead of letting the table widen the whole page.
  table.platform-info {
    width: 100%;
    max-width: 100%;
    table-layout: fixed;

    .info-attribute-name {
      text-align: left;
      width: 40%;
      overflow-wrap: anywhere;
    }

    .info-attribute-value {
      overflow-wrap: anywhere;
    }
  }
</style>
