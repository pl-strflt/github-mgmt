resource "github_membership" "this" {
  for_each = contains(local.resource_types, "github_membership") ? merge([
    for role, members in lookup(local.config, "members", {}) : {
      for member in members : "${member}" => {
        username = member
        role = role
      }
    }
  ]...) : {}

  username = each.value.username
  role = each.value.role

  lifecycle {
    ignore_changes = []
  }
}

resource "github_repository" "this" {
  for_each = {
    for repository, config in lookup(local.config, "repositories", {}) : repository => merge(config, {
      name = repository
    })
  }

  name = each.value.name
  allow_auto_merge   = try(each.value.allow_auto_merge, null)
  allow_merge_commit = try(each.value.allow_merge_commit, null)
  allow_rebase_merge = try(each.value.allow_rebase_merge, null)
  allow_squash_merge = try(each.value.allow_squash_merge, null)
  archive_on_destroy = try(each.value.archive_on_destroy, null)
  archived           = try(each.value.archived, null)
  auto_init          = try(each.value.auto_init, null)
  delete_branch_on_merge                  = try(each.value.delete_branch_on_merge, null)
  description                             = try(each.value.description, null)
  gitignore_template                      = try(each.value.gitignore_template, null)
  has_downloads                           = try(each.value.has_downloads, null)
  has_issues                              = try(each.value.has_issues, null)
  has_projects                            = try(each.value.has_projects, null)
  has_wiki                                = try(each.value.has_wiki, null)
  homepage_url                            = try(each.value.homepage_url, null)
  ignore_vulnerability_alerts_during_read = try(each.value.ignore_vulnerability_alerts_during_read, null)
  is_template                             = try(each.value.is_template, null)
  license_template                        = try(each.value.license_template, null)
  topics               = try(each.value.topics, null)
  visibility           = try(each.value.visibility, null)
  vulnerability_alerts = try(each.value.vulnerability_alerts, null)

  lifecycle {
    ignore_changes = [
      allow_auto_merge,
      allow_merge_commit,
      allow_rebase_merge,
      allow_squash_merge,
      archive_on_destroy,
      archived,
      auto_init,
      delete_branch_on_merge,
      description,
      gitignore_template,
      has_downloads,
      has_issues,
      has_projects,
      has_wiki,
      homepage_url,
      ignore_vulnerability_alerts_during_read,
      is_template,
      license_template,
      pages,
      template,
      topics,
      visibility,
      vulnerability_alerts
    ]
  }
}

resource "github_repository_collaborator" "this" {
  for_each = contains(local.resource_types, "github_repository_collaborator") ? merge(flatten([
    for repository, repository_config in lookup(local.config, "repositories", {}) :
    [
      for permission, members in lookup(repository_config, "collaborators", {}) : {
        for member in members : "${repository}:${member}" => {
          repository = repository
          username = member
          permission = permission
        }
      }
    ]
  ])...) : {}

  depends_on = [github_repository.this]

  repository = each.value.repository
  username = each.value.username
  permission                  = each.value.permission

  lifecycle {
    ignore_changes = []
  }
}

resource "github_branch_protection" "this" {
  for_each = contains(local.resource_types, "github_branch_protection") ? merge([
    for repository, repository_config in lookup(local.config, "repositories", {}) :
    {
      for pattern, config in lookup(repository_config, "branch_protection", {}) : "${repository}:${pattern}" => merge(config, {
        pattern = pattern
        repository_id = github_repository.this[repository].node_id
      })
    }
  ]...) : {}

  pattern = each.value.pattern
  repository_id = each.value.repository_id
  allows_deletions                = try(each.value.allows_deletions, null)
  allows_force_pushes             = try(each.value.allows_force_pushes, null)
  enforce_admins                  = try(each.value.enforce_admins, null)
  push_restrictions               = try(each.value.push_restrictions, null)
  require_conversation_resolution = try(each.value.require_conversation_resolution, null)
  require_signed_commits          = try(each.value.require_signed_commits, null)
  required_linear_history         = try(each.value.required_linear_history, null)

  dynamic "required_pull_request_reviews" {
    for_each = try([each.value.required_pull_request_reviews], [])
    content {
      dismiss_stale_reviews           = try(required_pull_request_reviews.value["dismiss_stale_reviews"], null)
      dismissal_restrictions          = try(required_pull_request_reviews.value["dismissal_restrictions"], null)
      require_code_owner_reviews      = try(required_pull_request_reviews.value["require_code_owner_reviews"], null)
      required_approving_review_count = try(required_pull_request_reviews.value["required_approving_review_count"], null)
      restrict_dismissals             = try(required_pull_request_reviews.value["restrict_dismissals"], null)
    }
  }
  dynamic "required_status_checks" {
    for_each = try([each.value.required_status_checks], [])
    content {
      contexts = try(required_status_checks.value["contexts"], null)
      strict   = try(required_status_checks.value["strict"], null)
    }
  }

  lifecycle {
    ignore_changes = [
      allows_deletions,
      allows_force_pushes,
      enforce_admins,
      push_restrictions,
      require_conversation_resolution,
      require_signed_commits,
      required_linear_history,
      required_pull_request_reviews,
      required_status_checks
    ]
  }
}

resource "github_team" "this" {
  for_each = contains(local.resource_types, "github_team") ? {
    for team, config in lookup(local.config, "teams", {}): team => merge(config, {
      name = team
      parent_team_id = try(try(element(data.github_organization_teams.this, index(data.github_organization_teams.this.*.id, config.parent_team_id)), config.parent_team_id), null)
    })
  } : {}

  name = each.value.name
  create_default_maintainer = try(each.value.create_default_maintainer, null)
  description               = try(each.value.description, null)
  ldap_dn                   = try(each.value.ldap_dn, null)
  parent_team_id            = try(each.value.parent_team_id, null)
  privacy                   = try(each.value.privacy, null)

  lifecycle {
    ignore_changes = [
      create_default_maintainer,
      description,
      parent_team_id,
      privacy,
    ]
  }
}

resource "github_team_repository" "this" {
  for_each = contains(local.resource_types, "github_team_repository") ? merge(flatten([
    for repository, repository_config in lookup(local.config, "repositories", {}) :
    [
      for permission, teams in lookup(repository_config, "teams", {}) : {
        for team in teams : "${team}:${repository}" => {
          repository = repository
          team_id = github_team.this[team].id
          permission = permission
        }
      }
    ]
  ])...) : {}

  depends_on = [
    github_repository.this
  ]

  repository = each.value.repository
  team_id = each.value.team_id

  permission = try(each.value.permission, null)

  lifecycle {
    ignore_changes = []
  }
}

resource "github_team_membership" "this" {
  for_each = contains(local.resource_types, "github_team_membership") ? merge(flatten([
    for team, team_config in lookup(local.config, "teams", {}) :
    [
      for role, members in lookup(team_config, "members", {}) : {
        for member in members : "${team}:${member}" => {
          team_id = github_team.this[team].id
          username = member
          role = role
        }
      }
    ]
  ])...) : {}

  team_id = each.value.team_id
  username = each.value.username
  role = each.value.role

  lifecycle {
    ignore_changes = []
  }
}

resource "github_repository_file" "this" {
  for_each = contains(local.resource_types, "github_repository_file") ? merge([
    for repository, repository_config in lookup(local.config, "repositories", {}) :
    {
      for config in [
        for file, config in lookup(repository_config, "files", {}) : merge(config, {
          repository = repository
          file = file
          branch = try(config.branch, github_repository.this[repository].default_branch)
          content = try(file("${path.module}/../files/${config.content}"), config.content)
        }) if contains(keys(config), "content")
      ]: "${config.repository}/${config.file}" => config
    }
  ]...) : {}

  repository = each.value.repository
  file = each.value.file
  content = each.value.content
  branch              = each.value.branch
  commit_author       = try(each.value.commit_author, null)
  commit_email        = try(each.value.commit_email, null)
  commit_message      = try(each.value.commit_message, null)
  overwrite_on_create = try(each.value.overwrite_on_create, null)

  lifecycle {
    ignore_changes = [
      commit_author,
      commit_email,
      commit_message,
      overwrite_on_create,
    ]
  }
}

resource "null_resource" "resources" {
  depends_on = [
    github_membership.this,
    github_repository.this,
    github_repository_collaborator.this,
    github_branch_protection.this,
    github_team.this,
    github_team_membership.this,
    github_team_membership.this,
    github_repository_file.this
  ]
}
