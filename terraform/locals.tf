locals {
  organization = terraform.workspace
  config = yamldecode(file("${path.module}/../github/${local.organization}.yml"))
  resource_types = [
    "github_repository",
    "github_branch_protection"
  ]
}
